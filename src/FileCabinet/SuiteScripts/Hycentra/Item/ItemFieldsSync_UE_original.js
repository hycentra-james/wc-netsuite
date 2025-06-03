/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */

define(['N/search', 'N/record', 'N/log'], function(search, record, log) {

    // Define an array of field IDs to update on the Kit/Package record
    var formIds = [199, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316];
    var fieldsToUpdate = []; // Add your field IDs here

    function afterSubmit(context) {
        if ((context.type === context.UserEventType.CREATE || context.type === context.UserEventType.EDIT)) {
            var newRecord = context.newRecord;
            var formId = parseInt(newRecord.getValue({ fieldId: 'customform' }));

            log.debug('DEBUG', 'formId = ' + formId + ' type = ' + typeof formId);
            if (!isNaN(formId) && formIds.indexOf(formId) !== -1) {
                log.debug('DEBUG', 'afterSubmit() start');

                // Get required update fields for the specific class
                getRequiredUpdateFields(newRecord);

                var itemId = newRecord.id;

                log.debug('DEBUG', 'itemId = ' + itemId);

                // Search for Kit/Package records containing the Inventory Item as a member item
                var kitItemSearch = search.create({
                    type: search.Type.KIT_ITEM,
                    filters: [
                        ['memberitem.internalid', search.Operator.ANYOF, itemId]
                    ],
                    columns: [
                        'internalid'
                    ]
                });

                var kitRS = kitItemSearch.run().getRange({ start: 0, end: 500 });

                log.audit('AUDIT', 'Total Kits for itemId (' + itemId + ') = ' + kitRS.length);

                // Add all member items to the Mis-shipped Item Parts sublist
                for (var j = 0; j < kitRS.length; j++) {
                    var kitId = kitRS[j].getValue('internalid');

                    log.audit('AUDIT', ' kitId = ' + kitId);
  
                    // Load the Kit/Package record
                    var kitRecord = record.load({
                        type: 'kititem', // Adjust record type as needed
                        id: kitId
                    });
    
                    // Update shared fields on the Kit/Package record
                    updateSharedFields(kitRecord, newRecord);
    
                    log.debug('DEBUG', ' kitId = ' + kitId);
                    log.debug('DEBUG', ' kitRecord.id = ' + kitRecord.id);
                    // Save the changes to the Kit/Package record
                    kitRecord.save();
    
                    // return true; // Continue processing search results
                }
                log.debug('DEBUG', 'afterSubmit() end');
            }
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

        } catch (error) {
            log.error({
                title: 'Error retrieving Item Fields Sync Map data',
                details: error
            });
        }

    }
    
    function printFields(record) {
        /*
        var allFields = record.getFields();

        fieldsToUpdate = allFields.filter(function(field) {
            // return field.indexOf('custitem_hyc_') === 0 || field.indexOf('custitem_fmt_') === 0;
            return field.indexOf('custitem_') === 0;
        });
        */
        fieldsToUpdate.forEach(function(fields, index) {
            log.debug('fieldsToUpdate - Field ID ' + index, fields.source); // Logs the field ID with its index
        });
    }

    function updateSharedFields(kitRecord, inventoryItemRecord) {
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

    return {
        afterSubmit: afterSubmit
    };

});
