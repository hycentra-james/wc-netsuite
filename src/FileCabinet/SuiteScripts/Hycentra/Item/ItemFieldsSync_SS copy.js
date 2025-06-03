/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log', 'N/task'], function(record, search, runtime, log, task) {

    // Configuration: List of custom record types to synchronize
    // Add new custom record types here to enable synchronization
    var RELATED_RECORD_TYPES = [
        {
            recordType: 'customrecord_hyc_cabinet_wood_material',
            baseItemField: 'custrecord_hyc_vanity_wood_mat_baseitem',
            description: 'Cabinet Wood Material'
        }
        // Add more custom record types here as needed:
        // {
        //     recordType: 'customrecord_another_type',
        //     baseItemField: 'custrecord_another_baseitem_field',
        //     description: 'Another Related Record Type'
        // }
    ];

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
    
                        // Synchronize related custom records
                        synchronizeRelatedRecords(itemId, kitId);

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

    /**
     * Synchronize related custom records from inventory item to kit
     * @param {string} itemId - The inventory item ID
     * @param {string} kitId - The kit item ID
     */
    function synchronizeRelatedRecords(itemId, kitId) {
        try {
            log.debug('Synchronizing Related Records', 'Item ID: ' + itemId + ' -> Kit ID: ' + kitId);
            
            // Loop through each configured custom record type
            RELATED_RECORD_TYPES.forEach(function(recordConfig) {
                synchronizeCustomRecordType(itemId, kitId, recordConfig);
            });
            
        } catch (e) {
            log.error('Error in synchronizeRelatedRecords', 'Item ID: ' + itemId + ', Kit ID: ' + kitId + ', Error: ' + e.message);
        }
    }

    /**
     * Synchronize a specific custom record type from inventory item to kit
     * @param {string} itemId - The inventory item ID
     * @param {string} kitId - The kit item ID
     * @param {Object} recordConfig - Configuration object for the custom record type
     */
    function synchronizeCustomRecordType(itemId, kitId, recordConfig) {
        try {
            log.debug('Processing Custom Record Type', recordConfig.description + ' (' + recordConfig.recordType + ')');
            
            // Find all related records for the inventory item
            var relatedRecords = getRelatedRecords(itemId, recordConfig);
            
            log.debug('Found Related Records', recordConfig.description + ': ' + relatedRecords.length + ' records');
            
            // For each related record, create or update corresponding record for the kit
            relatedRecords.forEach(function(relatedRecord) {
                createOrUpdateKitRelatedRecord(kitId, relatedRecord, recordConfig);
            });
            
        } catch (e) {
            log.error('Error in synchronizeCustomRecordType', 'Record Type: ' + recordConfig.recordType + ', Error: ' + e.message);
        }
    }

    /**
     * Get all related records of a specific type for an inventory item
     * @param {string} itemId - The inventory item ID
     * @param {Object} recordConfig - Configuration object for the custom record type
     * @returns {Array} Array of related record data
     */
    function getRelatedRecords(itemId, recordConfig) {
        try {
            var relatedRecords = [];
            
            var relatedRecordSearch = search.create({
                type: recordConfig.recordType,
                filters: [
                    [recordConfig.baseItemField, 'is', itemId]
                ],
                columns: ['internalid'] // We'll load the full record later to get all fields
            });

            var searchResults = relatedRecordSearch.run().getRange({
                start: 0,
                end: 1000
            });

            searchResults.forEach(function(result) {
                var recordId = result.getValue('internalid');
                
                // Load the full record to get all field values
                var fullRecord = record.load({
                    type: recordConfig.recordType,
                    id: recordId
                });
                
                relatedRecords.push({
                    id: recordId,
                    record: fullRecord
                });
            });

            return relatedRecords;
            
        } catch (e) {
            log.error('Error in getRelatedRecords', 'Item ID: ' + itemId + ', Record Type: ' + recordConfig.recordType + ', Error: ' + e.message);
            return [];
        }
    }

    /**
     * Create or update a related record for the kit
     * @param {string} kitId - The kit item ID
     * @param {Object} sourceRecordData - The source record data from inventory item
     * @param {Object} recordConfig - Configuration object for the custom record type
     */
    function createOrUpdateKitRelatedRecord(kitId, sourceRecordData, recordConfig) {
        try {
            var sourceRecord = sourceRecordData.record;
            
            // Check if a related record already exists for this kit
            var existingRecord = findExistingKitRelatedRecord(kitId, sourceRecord, recordConfig);
            
            if (existingRecord) {
                // Update existing record
                updateExistingRelatedRecord(existingRecord, sourceRecord, recordConfig);
                log.debug('Updated Existing Record', recordConfig.description + ' ID: ' + existingRecord);
            } else {
                // Create new record
                var newRecordId = createNewRelatedRecord(kitId, sourceRecord, recordConfig);
                log.debug('Created New Record', recordConfig.description + ' ID: ' + newRecordId);
            }
            
        } catch (e) {
            log.error('Error in createOrUpdateKitRelatedRecord', 'Kit ID: ' + kitId + ', Record Type: ' + recordConfig.recordType + ', Error: ' + e.message);
        }
    }

    /**
     * Find existing related record for kit (to avoid duplicates)
     * @param {string} kitId - The kit item ID
     * @param {Record} sourceRecord - The source record
     * @param {Object} recordConfig - Configuration object for the custom record type
     * @returns {string|null} Existing record ID or null if not found
     */
    function findExistingKitRelatedRecord(kitId, sourceRecord, recordConfig) {
        try {
            var sequenceField = getSequenceField(recordConfig.recordType);
            var filters = [
                [recordConfig.baseItemField, 'is', kitId]
            ];
            
            // If there's a sequence field, use it to match the specific record
            if (sequenceField) {
                var sequenceValue = sourceRecord.getValue(sequenceField);
                if (sequenceValue) {
                    filters.push('AND');
                    filters.push([sequenceField, 'is', sequenceValue]);
                }
            }
            
            var existingSearch = search.create({
                type: recordConfig.recordType,
                filters: filters,
                columns: ['internalid']
            });

            var results = existingSearch.run().getRange({ start: 0, end: 1 });
            
            return results.length > 0 ? results[0].getValue('internalid') : null;
            
        } catch (e) {
            log.error('Error in findExistingKitRelatedRecord', 'Kit ID: ' + kitId + ', Error: ' + e.message);
            return null;
        }
    }

    /**
     * Get the sequence field for a record type (used for matching records)
     * @param {string} recordType - The custom record type
     * @returns {string|null} The sequence field ID or null if not found
     */
    function getSequenceField(recordType) {
        // Map of record types to their sequence fields
        var sequenceFieldMap = {
            'customrecord_hyc_cabinet_wood_material': 'custrecord_hyc_vanity_wood_mat_seq'
            // Add more mappings as needed
        };
        
        return sequenceFieldMap[recordType] || null;
    }

    /**
     * Create a new related record for the kit
     * @param {string} kitId - The kit item ID
     * @param {Record} sourceRecord - The source record to copy from
     * @param {Object} recordConfig - Configuration object for the custom record type
     * @returns {string} New record ID
     */
    function createNewRelatedRecord(kitId, sourceRecord, recordConfig) {
        try {
            var newRecord = record.create({
                type: recordConfig.recordType
            });

            // Copy all fields from source record except the base item field
            var sourceFields = sourceRecord.getFields();
            
            sourceFields.forEach(function(fieldId) {
                if (fieldId !== recordConfig.baseItemField && fieldId !== 'id') {
                    try {
                        var fieldValue = sourceRecord.getValue(fieldId);
                        if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
                            newRecord.setValue({
                                fieldId: fieldId,
                                value: fieldValue
                            });
                        }
                    } catch (fieldError) {
                        // Skip fields that can't be copied (like system fields)
                        log.debug('Skipped Field', 'Field ID: ' + fieldId + ', Error: ' + fieldError.message);
                    }
                }
            });

            // Set the base item field to point to the kit
            newRecord.setValue({
                fieldId: recordConfig.baseItemField,
                value: kitId
            });

            return newRecord.save();
            
        } catch (e) {
            log.error('Error in createNewRelatedRecord', 'Kit ID: ' + kitId + ', Record Type: ' + recordConfig.recordType + ', Error: ' + e.message);
            throw e;
        }
    }

    /**
     * Update an existing related record for the kit
     * @param {string} existingRecordId - The existing record ID
     * @param {Record} sourceRecord - The source record to copy from
     * @param {Object} recordConfig - Configuration object for the custom record type
     */
    function updateExistingRelatedRecord(existingRecordId, sourceRecord, recordConfig) {
        try {
            var existingRecord = record.load({
                type: recordConfig.recordType,
                id: existingRecordId
            });

            var hasChanges = false;
            var sourceFields = sourceRecord.getFields();
            
            sourceFields.forEach(function(fieldId) {
                if (fieldId !== recordConfig.baseItemField && fieldId !== 'id') {
                    try {
                        var sourceValue = sourceRecord.getValue(fieldId);
                        var existingValue = existingRecord.getValue(fieldId);
                        
                        if (sourceValue !== existingValue && sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
                            existingRecord.setValue({
                                fieldId: fieldId,
                                value: sourceValue
                            });
                            hasChanges = true;
                        }
                    } catch (fieldError) {
                        // Skip fields that can't be updated
                        log.debug('Skipped Field Update', 'Field ID: ' + fieldId + ', Error: ' + fieldError.message);
                    }
                }
            });

            if (hasChanges) {
                existingRecord.save();
                log.debug('Updated Record', 'Record ID: ' + existingRecordId + ' has been updated');
            } else {
                log.debug('No Changes', 'Record ID: ' + existingRecordId + ' - no updates needed');
            }
            
        } catch (e) {
            log.error('Error in updateExistingRelatedRecord', 'Record ID: ' + existingRecordId + ', Error: ' + e.message);
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