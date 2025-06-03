/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log'], function (record, search, runtime, log) {
    
    /**
     * Get Input Data: Fetch the list of item IDs to process.
     */
    function getInputData() {
        var itemParam = runtime.getCurrentScript().getParameter({ name: 'custscript_item_ids' });
        var itemIds = itemParam.indexOf(",") > -1 ? itemParam.split(",") : [itemParam];

        log.debug('Input Data', 'Item IDs: ' + itemIds);
        return itemIds;
    }

    /**
     * Map Stage: Process each item ID, retrieve related kits, and prepare data for updates.
     */
    function map(context) {
        var itemId = context.value;

        try {
            var itemRecord = record.load({
                type: record.Type.INVENTORY_ITEM,
                id: itemId
            });

            log.debug('Processing Item', 'Item ID: ' + itemId);

            var kitItemSearch = search.create({
                type: search.Type.KIT_ITEM,
                filters: [['memberitem.internalid', search.Operator.ANYOF, itemId]],
                columns: ['internalid']
            });

            var kitIds = [];
            kitItemSearch.run().each(function (result) {
                kitIds.push(result.getValue('internalid'));
                return true;
            });

            var fieldsToUpdate = getRequiredUpdateFields(itemRecord);

            log.debug('Kit IDs', kitIds.length + ' kits found for Item ID ' + itemId);
            
            kitIds.forEach(function (kitId) {
                // Load the kit record and update shared fields
                var kitRecord = record.load({
                    type: record.Type.KIT_ITEM,
                    id: kitId,
                    isDynamic: true
                });
                log.debug("CCCCCCCCC", "Kit ID = " + kitId);

                updateSharedFields(fieldsToUpdate, kitRecord, itemRecord);
                log.debug("DDDDDDD", "kitRecord = " + kitRecord);

                kitRecord.save();
                log.debug("EEEEEEEEE");
                log.debug('Updated Kit', 'Kit ID: ' + kitId);
            });
        } catch (e) {
            log.error('Error in Map Stage', 'Item ID: ' + itemId + ', Error: ' + e.message);
        }
    }

    /**
     * Helper Function: Retrieve fields to update from custom records.
     */
    function getRequiredUpdateFields(itemRecord) {
        var categoryId = itemRecord.getValue({ fieldId: 'class' });

        var customRecordSearch = search.create({
            type: 'customrecord_hyc_item_fields_sync_map',
            filters: [['custrecord_hyc_item_field_sync_src_cat', 'is', categoryId]],
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
    }

    /**
     * Helper Function: Update shared fields on Kit record.
     */
    function updateSharedFields(fieldsToUpdate, kitRecord, inventoryItemRecord) {
        fieldsToUpdate.forEach(function (field) {
            try {
                var itemFieldValue = inventoryItemRecord.getValue({ fieldId: field.source });

                if (kitRecord.getValue({ fieldId: 'class' }) === field.targetCategory) {
                    var kitFieldValue = kitRecord.getValue({ fieldId: field.target });

                    if (itemFieldValue && itemFieldValue !== kitFieldValue) {
                        kitRecord.setValue({ fieldId: field.target, value: itemFieldValue });
                    }
                }
            } catch (e) {
                log.error('Error in updateSharedFields', 'field: ' + field.source + ', Error: ' + e.message);
            }
        });
    }

    return {
        getInputData: getInputData,
        map: map
    };
});