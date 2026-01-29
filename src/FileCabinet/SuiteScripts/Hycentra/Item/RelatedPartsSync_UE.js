/**
 * RelatedPartsSync_UE.js
 * User Event script deployed on customrecord_hyc_record_related_parts
 * Triggers Related Parts sync to Kits when Related Parts records are created/edited/deleted
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/task', 'N/runtime', 'N/log'], (record, search, task, runtime, log) => {

    /**
     * After Submit - Trigger sync when Related Parts record is created, edited, or deleted
     * @param {Object} context
     */
    const afterSubmit = (context) => {
        try {
            const eventType = context.type;

            // Handle create, edit, and delete events
            if (eventType !== context.UserEventType.CREATE &&
                eventType !== context.UserEventType.EDIT &&
                eventType !== context.UserEventType.DELETE) {
                return;
            }

            // IMPORTANT: Prevent infinite loop!
            // Only trigger sync when changes are made by USER (UI or CSV import)
            // Skip when changes are made by scripts (which is how the sync creates records)
            const executionContext = runtime.executionContext;
            const allowedContexts = [
                runtime.ContextType.USER_INTERFACE,
                runtime.ContextType.CSV_IMPORT,
                runtime.ContextType.CUSTOM_MASSUPDATE,
                runtime.ContextType.MASS_UPDATE
            ];

            if (!allowedContexts.includes(executionContext)) {
                log.debug('Skipping Sync', `Execution context is ${executionContext}, not user-initiated. Skipping to prevent loop.`);
                return;
            }

            log.audit('Related Parts Changed', `Event Type: ${eventType}, Context: ${executionContext}`);

            // Get the Base Item (inventory item) from the record
            let baseItemId;

            if (eventType === context.UserEventType.DELETE) {
                // For delete, use oldRecord since newRecord doesn't exist
                const oldRecord = context.oldRecord;
                if (!oldRecord) {
                    log.debug('No Old Record', 'DELETE event has no oldRecord, skipping');
                    return;
                }
                baseItemId = oldRecord.getValue({ fieldId: 'custrecord_hyc_itm_related_parts_baseitm' });
            } else {
                // For create/edit, use newRecord
                const newRecord = context.newRecord;
                if (!newRecord) {
                    log.debug('No New Record', `${eventType} event has no newRecord, skipping`);
                    return;
                }
                baseItemId = newRecord.getValue({ fieldId: 'custrecord_hyc_itm_related_parts_baseitm' });

                // Also check if Base Item changed (edit scenario)
                if (eventType === context.UserEventType.EDIT && context.oldRecord) {
                    const oldRecord = context.oldRecord;
                    const oldBaseItemId = oldRecord.getValue({ fieldId: 'custrecord_hyc_itm_related_parts_baseitm' });

                    // If Base Item changed, need to sync both old and new item's kits
                    if (oldBaseItemId && oldBaseItemId !== baseItemId) {
                        log.audit('Base Item Changed', `Old: ${oldBaseItemId}, New: ${baseItemId}`);
                        triggerSyncForItem(oldBaseItemId);
                    }
                }
            }

            if (!baseItemId) {
                log.debug('No Base Item', 'Related Parts record has no Base Item, skipping sync');
                return;
            }

            log.audit('Base Item Found', `Base Item ID: ${baseItemId}`);

            // Trigger sync for all Kits containing this Base Item
            triggerSyncForItem(baseItemId);

        } catch (e) {
            log.error('Error in RelatedPartsSync_UE', {
                message: e.message,
                name: e.name,
                stack: e.stack,
                eventType: context.type,
                recordId: context.newRecord?.id || context.oldRecord?.id || 'unknown'
            });
        }
    };

    /**
     * Trigger sync for all Kits containing the given inventory item
     * @param {string} itemId - The inventory item ID
     */
    const triggerSyncForItem = (itemId) => {
        try {
            // Find all Kits containing this item
            const kits = findKitsContainingItem(itemId);

            if (kits.length === 0) {
                log.debug('No Kits Found', `Item ${itemId} is not a member of any Kit`);
                return;
            }

            log.audit('Kits Found', `Found ${kits.length} Kits containing Item ${itemId}`);

            // Option 1: Trigger the existing Scheduled Script (safer for bulk)
            // This reuses the existing sync logic
            try {
                const scriptTask = task.create({
                    taskType: task.TaskType.SCHEDULED_SCRIPT,
                    scriptId: 'customscript_hyc_item_fields_sync_ss',
                    deploymentId: 'customdeploy_hyc_item_fields_sync_ss_dpl',
                    params: {
                        custscript_item_id: itemId
                    }
                });

                const taskId = scriptTask.submit();
                log.audit('Sync Triggered', `Task ID: ${taskId}, Item ID: ${itemId}`);

            } catch (taskError) {
                // If scheduled script fails (e.g., already queued), sync inline
                log.debug('Scheduled Script Failed', `Error: ${taskError.message}, falling back to inline sync`);
                syncRelatedPartsInline(kits);
            }

        } catch (e) {
            log.error('Error in triggerSyncForItem', `Item ID: ${itemId}, Error: ${e.message}`);
        }
    };

    /**
     * Find all Kit items that contain the given inventory item as a member
     * @param {string} itemId - The inventory item ID
     * @returns {Array} Array of Kit internal IDs
     */
    const findKitsContainingItem = (itemId) => {
        const kits = [];

        try {
            const kitSearch = search.create({
                type: search.Type.KIT_ITEM,
                filters: [
                    ['memberitem.internalid', 'anyof', itemId]
                ],
                columns: ['internalid']
            });

            kitSearch.run().each((result) => {
                kits.push(result.getValue('internalid'));
                return true; // Continue iteration
            });

        } catch (e) {
            log.error('Error in findKitsContainingItem', `Item ID: ${itemId}, Error: ${e.message}`);
        }

        return kits;
    };

    /**
     * Sync Related Parts inline (fallback if scheduled script can't be triggered)
     * @param {Array} kitIds - Array of Kit internal IDs
     */
    const syncRelatedPartsInline = (kitIds) => {
        kitIds.forEach((kitId) => {
            try {
                log.debug('Inline Sync', `Starting inline sync for Kit ID: ${kitId}`);

                // Delete all existing Related Parts for this Kit
                const deletedCount = deleteAllKitRelatedParts(kitId);
                log.debug('Deleted Related Parts', `Kit ID: ${kitId}, Deleted: ${deletedCount}`);

                // Get member items and recreate Related Parts
                const memberItems = getKitMemberItems(kitId);
                let totalCreated = 0;

                memberItems.forEach((memberItemId) => {
                    const createdCount = createRelatedPartsFromMember(kitId, memberItemId);
                    totalCreated += createdCount;
                });

                log.audit('Inline Sync Complete', `Kit ID: ${kitId}, Created: ${totalCreated} Related Parts`);

            } catch (e) {
                log.error('Error in inline sync', `Kit ID: ${kitId}, Error: ${e.message}`);
            }
        });
    };

    /**
     * Delete ALL Related Parts records for a Kit
     * @param {string} kitId - The kit item ID
     * @returns {number} Number of records deleted
     */
    const deleteAllKitRelatedParts = (kitId) => {
        let deletedCount = 0;

        try {
            const relatedPartsSearch = search.create({
                type: 'customrecord_hyc_record_related_parts',
                filters: [
                    ['custrecord_hyc_itm_related_parts_baseitm', 'is', kitId]
                ],
                columns: ['internalid']
            });

            const results = relatedPartsSearch.run().getRange({ start: 0, end: 1000 });

            results.forEach((result) => {
                try {
                    record.delete({
                        type: 'customrecord_hyc_record_related_parts',
                        id: result.getValue('internalid')
                    });
                    deletedCount++;
                } catch (deleteError) {
                    log.error('Error deleting Related Part', `Record ID: ${result.getValue('internalid')}, Error: ${deleteError.message}`);
                }
            });

        } catch (e) {
            log.error('Error in deleteAllKitRelatedParts', `Kit ID: ${kitId}, Error: ${e.message}`);
        }

        return deletedCount;
    };

    /**
     * Get all member item IDs of a Kit
     * @param {string} kitId - The kit item ID
     * @returns {Array} Array of member item internal IDs
     */
    const getKitMemberItems = (kitId) => {
        const memberItems = [];

        try {
            const kitRecord = record.load({
                type: 'kititem',
                id: kitId
            });

            const memberCount = kitRecord.getLineCount({ sublistId: 'member' });

            for (let i = 0; i < memberCount; i++) {
                const memberItemId = kitRecord.getSublistValue({
                    sublistId: 'member',
                    fieldId: 'item',
                    line: i
                });
                if (memberItemId) {
                    memberItems.push(memberItemId);
                }
            }

        } catch (e) {
            log.error('Error in getKitMemberItems', `Kit ID: ${kitId}, Error: ${e.message}`);
        }

        return memberItems;
    };

    /**
     * Create Related Parts records for Kit from a member item's Related Parts
     * @param {string} kitId - The kit item ID
     * @param {string} memberItemId - The member inventory item ID
     * @returns {number} Number of records created
     */
    const createRelatedPartsFromMember = (kitId, memberItemId) => {
        let createdCount = 0;

        try {
            const relatedPartsSearch = search.create({
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

            const results = relatedPartsSearch.run().getRange({ start: 0, end: 1000 });

            results.forEach((result) => {
                try {
                    const newRecord = record.create({
                        type: 'customrecord_hyc_record_related_parts'
                    });

                    // Set Base Item to Kit
                    newRecord.setValue({
                        fieldId: 'custrecord_hyc_itm_related_parts_baseitm',
                        value: kitId
                    });

                    // Copy Part Category
                    const partCategory = result.getValue('custrecord_hyc_itm_part_cats');
                    if (partCategory) {
                        newRecord.setValue({
                            fieldId: 'custrecord_hyc_itm_part_cats',
                            value: partCategory
                        });
                    }

                    // Copy Part
                    const part = result.getValue('custrecord_hyc_itm_related_parts_part');
                    if (part) {
                        newRecord.setValue({
                            fieldId: 'custrecord_hyc_itm_related_parts_part',
                            value: part
                        });
                    }

                    // Copy Quantity
                    const qty = result.getValue('custrecord_hyc_itm_related_parts_qty');
                    if (qty) {
                        newRecord.setValue({
                            fieldId: 'custrecord_hyc_itm_related_parts_qty',
                            value: qty
                        });
                    }

                    newRecord.save();
                    createdCount++;

                } catch (createError) {
                    log.error('Error creating Related Part', `Kit ID: ${kitId}, Error: ${createError.message}`);
                }
            });

        } catch (e) {
            log.error('Error in createRelatedPartsFromMember', `Kit ID: ${kitId}, Member: ${memberItemId}, Error: ${e.message}`);
        }

        return createdCount;
    };

    return {
        afterSubmit
    };
});
