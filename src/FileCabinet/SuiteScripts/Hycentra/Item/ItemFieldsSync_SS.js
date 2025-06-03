/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log', 'N/task'], function(record, search, runtime, log, task) {

    function execute(context) {
        try {
            // Retrieve parameters passed from User Event Script
            var itemParam = runtime.getCurrentScript().getParameter({ name: 'custscript_item_id' });
            var itemIds = itemParam.indexOf(",") > -1 ? itemParam.split(",") : [itemParam];

            log.audit('DEBUG', 'itemIds = ' + itemIds);
            for (var i in itemIds) {
                var itemId = itemIds[i];

                var itemRecord = record.load({
                    type: record.Type.INVENTORY_ITEM, // or other item type
                    id: itemId
                });
                
    
                log.audit('Processing Item', 'Item ID: ' + itemId );
    
                if (!itemId) {
                    log.error('Missing Parameters', 'itemId is null');
                    return;
                }
    
                // Search for kits containing the item
                var kitItemSearch = search.create({
                    type: search.Type.KIT_ITEM,
                    filters: [
                        ['memberitem.internalid', search.Operator.ANYOF, itemId]
                    ],
                    columns: [
                        'internalid'
                    ]
                });
    
                var resultSet = kitItemSearch.run();
                var batchSize = 50;
                var start = runtime.getCurrentScript().getParameter({ name: 'custscript_start_index' }) || 0;
                var kitRS;
    
                var fieldsToUpdate = getRequiredUpdateFields(itemRecord);
    
                log.debug('DEBUG', 'fieldsToUpdate: ' + fieldsToUpdate.length);
    
                do {
                    kitRS = resultSet.getRange({ start: start, end: start + batchSize });
    
                    for (var i = 0; i < kitRS.length; i++) {
                        var kitId = kitRS[i].getValue('internalid');

                        log.debug('Processing Kit', 'Kit ID: ' + kitId);
    
                        // Load the kit record and update shared fields
                        var kitRecord = record.load({
                            type: 'kititem',
                            id: kitId
                        });
    
                        updateSharedFields(fieldsToUpdate, kitRecord, itemRecord);
    
                        kitRecord.save();
                        log.debug('Updated Kit', 'Kit ID: ' + kitId);
                    }
    
                    start += batchSize;
    
                    // Check remaining usage and reschedule if necessary
                    if (runtime.getCurrentScript().getRemainingUsage() < 200) {
                        rescheduleScript(itemRecord, itemId, start);
                        return;
                    }
                } while (kitRS.length === batchSize);

                log.audit('Processing Item', 'Item ID: ' + itemId + ' [Finished]');
            }
        } catch (e) {
            log.error('Error in Scheduled Script', e);
        }
    }

    function getRequiredUpdateFields(record){
        try {
            // Retrieve the internal ID of the record category
            var categoryId = record.getValue({ fieldId: 'class' });

            // Create a search to find the Item Fields Sync Map with the specified category
            var customRecordSearch = search.create({
                type: 'customrecord_hyc_item_fields_sync_map', // Your custom record type ID
                filters: [
                    ['custrecord_hyc_item_field_sync_src_cat', 'is', categoryId] // Filter by the specified category
                ],
                columns: [
                    'custrecord_hyc_item_field_sync_tar_cat', // The specific column to retrieve
                    'custrecord_hyc_item_fields_sync_src_id', // The specific column to retrieve
                    'custrecord_hyc_item_fields_sync_tar_id' // The specific column to retrieve
                ]
            });

            // Get the search results
            var searchResults = customRecordSearch.run().getRange({
                start: 0,
                end: 1000 // Adjust as needed
            });

            log.debug('DEBUG', 'searchResults.length = ' + searchResults.length);
            // Retrieve the desired column values from the search results
            fieldsToUpdate = [];
            searchResults.forEach(function(result) {
                var targetCategory = result.getValue({
                    name: 'custrecord_hyc_item_field_sync_tar_cat'
                });
                var sourceFieldId = result.getValue({
                    name: 'custrecord_hyc_item_fields_sync_src_id'
                });
                var targetFieldId = result.getValue({
                    name: 'custrecord_hyc_item_fields_sync_tar_id'
                });

                // Push an object containing both source and target field IDs
                fieldsToUpdate.push({
                    targetCategory: targetCategory,
                    source: sourceFieldId,
                    target: targetFieldId
                });
            });
            log.debug('DEBUG', 'fieldsToUpdate.length = ' + fieldsToUpdate.length);

            return fieldsToUpdate;

        } catch (error) {
            log.error({
                title: 'Error retrieving Item Fields Sync Map data',
                details: error
            });
        }

    }

function updateSharedFields(fieldsToUpdate, kitRecord, inventoryItemRecord) {
        // Loop through the array of field IDs and update corresponding fields on the Kit/Package record
        fieldsToUpdate.forEach(function(field) {
            log.debug('DEBUG', 'Source fieldId = ' + field.source);
            log.debug('DEBUG', 'Target fieldId = ' + field.target);

            // Inventory Item Source Field
            var itemFieldValue = inventoryItemRecord.getValue({ fieldId: field.source });

            log.debug('DEBUG', 'Item field value = ' + itemFieldValue);
            log.debug('DEBUG', 'Kit field value = ' + kitRecord.getValue({ fieldId: field.target }));
            
            // Check if the target Category is the same as the Kit item
            if (kitRecord.getValue({ fieldId: 'class' }) === field.targetCategory) {
                // Update the Kit target field only when it's being updated to avoid bombarding the audit/trail
                var kitFieldValue = kitRecord.getValue({ fieldId: field.target });
                if (itemFieldValue && itemFieldValue != kitFieldValue) {
                    log.debug('DEBUG', 'Updating fieldValue = ' + itemFieldValue);
                    kitRecord.setValue({ fieldId: field.target, value: itemFieldValue });
                } else {
                    log.debug('DEBUG', 'Skipped - value unchanged or value is empty,  ' + itemFieldValue);
                }
            } else {
                // log.debug('DEBUG', 'Target Category does not match' + fieldValue);
                // log.debug('DEBUG', 'Kit category = ' + kitRecord.getValue({ fieldId: 'class' }));
                // log.debug('DEBUG', 'field.targetCategory = ' + field.targetCategory);
            }
        });
    }

    // Reschedule the script to process remaining records
    function rescheduleScript(itemId, start) {
        try {
            var scriptTask = task.create({
                taskType: task.TaskType.SCHEDULED_SCRIPT,
                scriptId: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                params: {
                    custscript_item_id: itemId,
                    custscript_start_index: start
                }
            });

            var taskId = scriptTask.submit();
            log.debug('Rescheduled Script', 'Task ID: ' + taskId + ', Start Index: ' + start);
        } catch (e) {
            log.error('Error Rescheduling Script', e.message);
        }
    }

    return {
        execute: execute
    };
});