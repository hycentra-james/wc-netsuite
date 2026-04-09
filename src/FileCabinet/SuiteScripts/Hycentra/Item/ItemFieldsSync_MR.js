/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 *
 * WC-563: Kit Field Sync - Map/Reduce Implementation
 * ---------------------------------------------------
 * Replaces the per-item Scheduled Script approach to fix queue collision
 * during bulk CSV imports. Previously, the UE submitted one SS task per item,
 * but only the first succeeded because subsequent task.submit() calls failed
 * silently when the same SS deployment was already queued/running.
 *
 * This MR script can be triggered two ways:
 *   1. Explicitly via UE afterSubmit - receives comma-separated item IDs in custscript_mr_item_ids
 *   2. On a schedule (e.g. every 15 min) - searches for recently modified items as a safety net
 *
 * The map stage processes each item independently (parallel-safe), performing:
 *   - Field sync from inventory item to parent kit(s)
 *   - Related custom record sync (Cabinet Wood Material, etc.)
 *   - Related Parts aggregation sync
 *
 * All sync logic is ported from ItemFieldsSync_SS.js to keep behavior identical.
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log'], function (record, search, runtime, log) {

    // Valid form IDs that should trigger sync (must match UE gate logic)
    var VALID_FORM_IDS = [199, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316];

    /**
     * getInputData: Determine which items need syncing.
     *
     * Priority 1: If custscript_mr_item_ids param is set (from UE trigger), use those IDs.
     * Priority 2: If no param (scheduled run), search for recently modified inventory items
     *             on valid forms as a catch-all safety net.
     */
    function getInputData() {
        var itemParam = runtime.getCurrentScript().getParameter({ name: 'custscript_mr_item_ids' });

        if (itemParam) {
            // Explicit item IDs passed from UE or manual trigger
            var itemIds = itemParam.indexOf(',') > -1 ? itemParam.split(',') : [itemParam];
            // Trim whitespace and filter empties
            itemIds = itemIds.map(function (id) { return id.trim(); }).filter(function (id) { return id; });
            log.audit('getInputData', 'Processing ' + itemIds.length + ' explicit item IDs: ' + itemIds.join(', '));
            return itemIds;
        }

        // Safety net: search for inventory items modified in the last 60 minutes on valid forms.
        // This catches any items missed due to task submission failures.
        log.audit('getInputData', 'No explicit IDs - running scheduled catch-all search');
        return search.create({
            type: search.Type.INVENTORY_ITEM,
            filters: [
                ['lastmodifieddate', 'within', 'lasthour'],
                'AND',
                ['customform', 'anyof', VALID_FORM_IDS]
            ],
            columns: ['internalid']
        });
    }

    /**
     * Map Stage: Process each item independently.
     * Each item is synced to all parent kits that contain it as a member.
     */
    function map(context) {
        // context.value can be:
        // 1. A plain string ID from array input (e.g., "10865")
        // 2. A JSON string from search result (e.g., '{"id":"10865","values":{...}}')
        // 3. A JSON number from array input after MR serialization (e.g., "660" which JSON.parse returns as number 660)
        var itemId;
        try {
            var parsed = JSON.parse(context.value);
            if (typeof parsed === 'number' || typeof parsed === 'string') {
                // Plain ID that was JSON-parseable (e.g., "660" -> 660, or "\"660\"" -> "660")
                itemId = String(parsed);
            } else if (parsed && parsed.id) {
                // Search result format: { id: "123", ... }
                itemId = parsed.id;
            } else if (parsed && parsed.values && parsed.values.internalid) {
                itemId = parsed.values.internalid.value || parsed.values.internalid;
            }
        } catch (e) {
            // Not valid JSON - use raw string value
            itemId = context.value;
        }

        // Final cleanup: trim whitespace
        if (itemId) {
            itemId = String(itemId).trim();
        }

        if (!itemId) {
            log.error('Map - Missing Item ID', 'Could not parse item ID from: ' + context.value);
            return;
        }

        try {
            log.audit('Map - Processing Item', 'Item ID: ' + itemId);

            var itemRecord = record.load({
                type: record.Type.INVENTORY_ITEM,
                id: itemId
            });

            var itemCategory = itemRecord.getValue({ fieldId: 'class' });
            var itemCategoryText = itemRecord.getText({ fieldId: 'class' });
            log.audit('Map - Item Category', 'Item ID: ' + itemId + ', Category: ' + itemCategory + ' (' + itemCategoryText + ')');

            // Find all kits that contain this item as a member
            var kitItemSearch = search.create({
                type: search.Type.KIT_ITEM,
                filters: [
                    ['memberitem.internalid', search.Operator.ANYOF, itemId]
                ],
                columns: ['internalid', 'class']
            });

            var kitIds = [];
            kitItemSearch.run().each(function (result) {
                kitIds.push(result.getValue('internalid'));
                return true;
            });

            if (kitIds.length === 0) {
                log.audit('Map - No Kits Found', 'Item ID: ' + itemId + ' is not a member of any kits');
                return;
            }

            log.audit('Map - Kits Found', 'Item ID: ' + itemId + ' is a member of ' + kitIds.length + ' kits');

            // Get field mappings for this item's category
            var fieldsToUpdate = getRequiredUpdateFields(itemRecord);
            log.audit('Map - Field Mappings', 'Found ' + (fieldsToUpdate ? fieldsToUpdate.length : 0) + ' field mappings for category ' + itemCategory);

            // Process each kit
            kitIds.forEach(function (kitId) {
                try {
                    var kitRecord = record.load({
                        type: 'kititem',
                        id: kitId
                    });

                    var kitCategoryId = kitRecord.getValue({ fieldId: 'class' });
                    var kitCategoryText = kitRecord.getText({ fieldId: 'class' });
                    log.audit('Map - Processing Kit', 'Kit ID: ' + kitId + ', Category: ' + kitCategoryId + ' (' + kitCategoryText + ')');

                    // 1. Sync shared fields from inventory item to kit
                    updateSharedFields(fieldsToUpdate, kitRecord, itemRecord);

                    // 2. Save kit record BEFORE related parts sync
                    //    (avoids "Items have been deleted since you retrieved the form" error)
                    kitRecord.save();
                    log.debug('Map - Kit Saved', 'Kit ID: ' + kitId);

                    // 4. Sync Related Parts (aggregate from ALL member items)
                    //    Done AFTER kit save to avoid record conflicts
                    syncRelatedPartsToKit(kitId, kitRecord);

                } catch (kitError) {
                    log.error('Map - Kit Processing Error', 'Item ID: ' + itemId + ', Kit ID: ' + kitId + ', Error: ' + kitError.message);
                }
            });

            // Write to reduce for summary tracking
            context.write({
                key: itemId,
                value: { kitCount: kitIds.length, fieldMappings: fieldsToUpdate ? fieldsToUpdate.length : 0 }
            });

            log.audit('Map - Item Complete', 'Item ID: ' + itemId + ' synced to ' + kitIds.length + ' kits');

        } catch (e) {
            log.error('Map - Error', 'Item ID: ' + itemId + ', Error: ' + e.message + '\nStack: ' + e.stack);
        }
    }

    /**
     * Summarize: Log overall results for audit trail.
     */
    function summarize(summary) {
        var totalItems = 0;
        var totalKits = 0;
        var errors = [];

        summary.output.iterator().each(function (key, value) {
            totalItems++;
            try {
                var data = JSON.parse(value);
                totalKits += data.kitCount || 0;
            } catch (e) {
                // ignore parse errors
            }
            return true;
        });

        // Collect map stage errors
        summary.mapSummary.errors.iterator().each(function (key, error) {
            errors.push('Item ' + key + ': ' + error);
            return true;
        });

        log.audit('Summarize - Complete',
            'Items Processed: ' + totalItems +
            ', Kits Updated: ' + totalKits +
            ', Errors: ' + errors.length +
            ', Duration: ' + summary.seconds + 's' +
            ', Usage: ' + summary.usage
        );

        if (errors.length > 0) {
            log.error('Summarize - Errors', errors.join('\n'));
        }
    }

    // =========================================================================
    // Sync Logic (ported from ItemFieldsSync_SS.js)
    // =========================================================================
    // NOTE: synchronizeRelatedRecords was removed (WC-563 cleanup).
    // It referenced customrecord_hyc_related_record_config which doesn't exist.
    // Can be re-implemented when the config custom record is created.
    // =========================================================================

    /**
     * Sync Related Parts from ALL member items to the Kit
     * Aggregate sync: deletes all existing Kit Related Parts and recreates from all members
     */
    function syncRelatedPartsToKit(kitId, kitRecord) {
        try {
            log.audit('Related Parts Sync', 'Kit ID: ' + kitId);

            // Step 1: Delete ALL existing Related Parts for this Kit
            var deletedCount = deleteAllKitRelatedParts(kitId);

            // Step 2: Get ALL member items of this Kit
            var memberItems = getKitMemberItems(kitId, kitRecord);

            if (memberItems.length === 0) {
                log.audit('Related Parts Sync', 'Kit ID: ' + kitId + ' - no members found');
                return;
            }

            // Step 3: For each member item, get its Related Parts and create for Kit
            var totalCreated = 0;
            memberItems.forEach(function (memberItemId) {
                totalCreated += createRelatedPartsFromMember(kitId, memberItemId);
            });

            log.audit('Related Parts Sync Complete', 'Kit: ' + kitId + ', Deleted: ' + deletedCount + ', Created: ' + totalCreated + ' from ' + memberItems.length + ' members');

        } catch (e) {
            log.error('Error in syncRelatedPartsToKit', 'Kit: ' + kitId + ', Error: ' + e.message);
        }
    }

    /**
     * Delete ALL Related Parts records for a Kit
     */
    function deleteAllKitRelatedParts(kitId) {
        try {
            var deletedCount = 0;

            var relatedPartsSearch = search.create({
                type: 'customrecord_hyc_record_related_parts',
                filters: [
                    ['custrecord_hyc_itm_related_parts_baseitm', 'is', kitId]
                ],
                columns: ['internalid']
            });

            var results = relatedPartsSearch.run().getRange({ start: 0, end: 1000 });

            results.forEach(function (result) {
                try {
                    record.delete({
                        type: 'customrecord_hyc_record_related_parts',
                        id: result.getValue('internalid')
                    });
                    deletedCount++;
                } catch (deleteError) {
                    log.error('Error deleting Related Part', 'Record: ' + result.getValue('internalid') + ', Error: ' + deleteError.message);
                }
            });

            return deletedCount;

        } catch (e) {
            log.error('Error in deleteAllKitRelatedParts', 'Kit: ' + kitId + ', Error: ' + e.message);
            return 0;
        }
    }

    /**
     * Get all member item IDs of a Kit
     */
    function getKitMemberItems(kitId, existingKitRecord) {
        try {
            var memberItems = [];
            var kitRec = existingKitRecord || record.load({ type: 'kititem', id: kitId });
            var memberCount = kitRec.getLineCount({ sublistId: 'member' });

            for (var i = 0; i < memberCount; i++) {
                var memberItemId = kitRec.getSublistValue({
                    sublistId: 'member',
                    fieldId: 'item',
                    line: i
                });
                if (memberItemId) {
                    memberItems.push(memberItemId);
                }
            }

            return memberItems;

        } catch (e) {
            log.error('Error in getKitMemberItems', 'Kit: ' + kitId + ', Error: ' + e.message);
            return [];
        }
    }

    /**
     * Create Related Parts records for Kit from a member item's Related Parts
     */
    function createRelatedPartsFromMember(kitId, memberItemId) {
        try {
            var createdCount = 0;

            var relatedPartsSearch = search.create({
                type: 'customrecord_hyc_record_related_parts',
                filters: [
                    ['custrecord_hyc_itm_related_parts_baseitm', 'is', memberItemId]
                ],
                columns: [
                    'internalid',
                    'custrecord_hyc_itm_part_cats',
                    'custrecord_hyc_itm_related_parts_part',
                    'custrecord_hyc_itm_related_parts_qty'
                ]
            });

            var results = relatedPartsSearch.run().getRange({ start: 0, end: 1000 });

            results.forEach(function (result) {
                try {
                    var newRec = record.create({
                        type: 'customrecord_hyc_record_related_parts'
                    });

                    newRec.setValue({ fieldId: 'custrecord_hyc_itm_related_parts_baseitm', value: kitId });

                    var partCategory = result.getValue('custrecord_hyc_itm_part_cats');
                    if (partCategory) {
                        newRec.setValue({ fieldId: 'custrecord_hyc_itm_part_cats', value: partCategory });
                    }

                    var part = result.getValue('custrecord_hyc_itm_related_parts_part');
                    if (part) {
                        newRec.setValue({ fieldId: 'custrecord_hyc_itm_related_parts_part', value: part });
                    }

                    var qty = result.getValue('custrecord_hyc_itm_related_parts_qty');
                    if (qty) {
                        newRec.setValue({ fieldId: 'custrecord_hyc_itm_related_parts_qty', value: qty });
                    }

                    newRec.save();
                    createdCount++;

                } catch (createError) {
                    log.error('Error creating Related Part', 'Kit: ' + kitId + ', Source: ' + result.getValue('internalid') + ', Error: ' + createError.message);
                }
            });

            return createdCount;

        } catch (e) {
            log.error('Error in createRelatedPartsFromMember', 'Kit: ' + kitId + ', Member: ' + memberItemId + ', Error: ' + e.message);
            return 0;
        }
    }

    /**
     * Get field mappings from custom record for the item's category
     */
    function getRequiredUpdateFields(itemRecord) {
        try {
            var categoryId = itemRecord.getValue({ fieldId: 'class' });

            var customRecordSearch = search.create({
                type: 'customrecord_hyc_item_fields_sync_map',
                filters: [
                    ['custrecord_hyc_item_field_sync_src_cat', 'is', categoryId]
                ],
                columns: [
                    'custrecord_hyc_item_field_sync_tar_cat',
                    'custrecord_hyc_item_fields_sync_src_id',
                    'custrecord_hyc_item_fields_sync_tar_id'
                ]
            });

            var fieldsToUpdate = [];
            customRecordSearch.run().each(function (result) {
                fieldsToUpdate.push({
                    targetCategory: result.getValue('custrecord_hyc_item_field_sync_tar_cat'),
                    source: result.getValue('custrecord_hyc_item_fields_sync_src_id'),
                    target: result.getValue('custrecord_hyc_item_fields_sync_tar_id')
                });
                return true;
            });

            return fieldsToUpdate;

        } catch (error) {
            log.error('Error retrieving field mappings', error);
            return [];
        }
    }

    /**
     * Update shared fields on Kit record from inventory item
     */
    function updateSharedFields(fieldsToUpdate, kitRecord, inventoryItemRecord) {
        var kitCategoryId = kitRecord.getValue({ fieldId: 'class' });
        var updateCount = 0;

        fieldsToUpdate.forEach(function (field) {
            var itemFieldValue = inventoryItemRecord.getValue({ fieldId: field.source });

            // Only update if target category matches the kit's category
            if (String(kitCategoryId) === String(field.targetCategory)) {
                var kitFieldValue = kitRecord.getValue({ fieldId: field.target });
                if (itemFieldValue && itemFieldValue != kitFieldValue) {
                    kitRecord.setValue({ fieldId: field.target, value: itemFieldValue });
                    updateCount++;
                }
            }
        });

        if (updateCount > 0) {
            log.audit('Fields Updated', updateCount + ' of ' + fieldsToUpdate.length + ' fields updated on Kit ' + kitRecord.id);
        }
    }

    return {
        getInputData: getInputData,
        map: map,
        summarize: summarize
    };
});
