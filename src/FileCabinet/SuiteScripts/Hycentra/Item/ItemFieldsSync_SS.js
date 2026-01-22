/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log', 'N/task'], function(record, search, runtime, log, task) {

    /**
     * Load related record configurations from custom records
     * @returns {Array} Array of configuration objects
     */
    function getRelatedRecordConfigurations() {
        try {
            var configurations = [];
            
            // Search for configuration records
            // Assuming custom record type: customrecord_hyc_related_record_config
            var configSearch = search.create({
                type: 'customrecord_hyc_related_record_config',
                filters: [
                    ['isinactive', 'is', 'F'] // Only active configurations
                ],
                columns: [
                    'custrecord_hyc_rrc_record_type',      // Related Record Type ID
                    'custrecord_hyc_rrc_base_item_field',  // Base Item Field ID
                    'custrecord_hyc_rrc_description',      // Description
                    'custrecord_hyc_rrc_fields_to_sync',   // Fields to Sync (comma separated)
                    'custrecord_hyc_rrc_identifier_field'  // Identifier Field ID
                ]
            });

            var results = configSearch.run().getRange({ start: 0, end: 100 });
            
            log.debug('Configuration Records Found', 'Found ' + results.length + ' configuration records');

            results.forEach(function(result, index) {
                var recordType = result.getValue('custrecord_hyc_rrc_record_type');
                var baseItemField = result.getValue('custrecord_hyc_rrc_base_item_field');
                var description = result.getValue('custrecord_hyc_rrc_description');
                var fieldsToSyncStr = result.getValue('custrecord_hyc_rrc_fields_to_sync');
                var identifierField = result.getValue('custrecord_hyc_rrc_identifier_field');
                
                // Convert comma-separated fields to array
                var fieldsToSync = [];
                if (fieldsToSyncStr) {
                    fieldsToSync = fieldsToSyncStr.split(',').map(function(field) {
                        return field.trim();
                    });
                }
                
                var config = {
                    recordType: recordType,
                    baseItemField: baseItemField,
                    description: description,
                    fieldsToSync: fieldsToSync,
                    identifierField: identifierField
                };
                
                configurations.push(config);
                
                log.debug('Loaded Configuration ' + (index + 1), 
                    'Type: ' + recordType + 
                    ', Description: ' + description + 
                    ', Fields: [' + fieldsToSync.join(', ') + ']' +
                    ', Identifier: ' + identifierField
                );
            });
            
            log.debug('Total Configurations Loaded', configurations.length + ' configurations loaded successfully');
            return configurations;
            
        } catch (e) {
            log.error('Error loading configurations', 'Error: ' + e.message);
            // Return hardcoded fallback configuration if custom records are not available
            return [{
                recordType: 'customrecord_hyc_cabinet_wood_material',
                baseItemField: 'custrecord_hyc_vanity_wood_mat_baseitem',
                description: 'Cabinet Wood Material (Fallback)',
                fieldsToSync: [
                    'custrecord_hyc_vanity_wood_mat_seq',
                    'custrecord_hyc_vanity_wood_mat_material',
                    'custrecord_hyc_vanity_wood_mat_pct',
                    'custrecord_hyc_vanity_wood_mat_grow_loc',
                    'custrecord_hyc_vanity_wood_wood_region'
                ],
                identifierField: 'custrecord_hyc_vanity_wood_mat_seq'
            }];
        }
    }

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
                
    
                var itemCategory = itemRecord.getValue({ fieldId: 'class' });
                var itemCategoryText = itemRecord.getText({ fieldId: 'class' });
                log.audit('Processing Item', 'Item ID: ' + itemId + ', Category ID: ' + itemCategory + ' (' + itemCategoryText + ')');

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
                        'internalid',
                        'class'
                    ]
                });

                var resultSet = kitItemSearch.run();
                var batchSize = 50;
                var start = runtime.getCurrentScript().getParameter({ name: 'custscript_start_index' }) || 0;
                var kitRS;

                var fieldsToUpdate = getRequiredUpdateFields(itemRecord);

                log.audit('Field Mappings Found', 'fieldsToUpdate count: ' + (fieldsToUpdate ? fieldsToUpdate.length : 0) + ' for source category: ' + itemCategory);
    
                do {
                    kitRS = resultSet.getRange({ start: start, end: start + batchSize });

                    log.audit('Kit Batch Retrieved', 'Found ' + kitRS.length + ' kits in batch starting at ' + start);

                    for (var j = 0; j < kitRS.length; j++) {
                        var kitId = kitRS[j].getValue('internalid');
                        var kitCategoryFromSearch = kitRS[j].getValue('class');

                        log.audit('Processing Kit', 'Kit ID: ' + kitId + ', Category from search: ' + kitCategoryFromSearch);

                        // Load the kit record and update shared fields
                        var kitRecord = record.load({
                            type: 'kititem',
                            id: kitId
                        });

                        var kitCategoryId = kitRecord.getValue({ fieldId: 'class' });
                        var kitCategoryText = kitRecord.getText({ fieldId: 'class' });
                        log.audit('Kit Category Details', 'Kit ID: ' + kitId + ', Category ID: ' + kitCategoryId + ' (' + kitCategoryText + '), Type: ' + typeof kitCategoryId);

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
            
            // Load configurations from custom records
            var relatedRecordConfigs = getRelatedRecordConfigurations();
            
            // Loop through each configured custom record type
            relatedRecordConfigs.forEach(function(recordConfig) {
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
            
            log.debug('Found Related Records', recordConfig.description + ': ' + relatedRecords.length + ' records for Item ID: ' + itemId);
            
            // For each related record, create or update corresponding record for the kit
            relatedRecords.forEach(function(relatedRecord, index) {
                log.debug('Processing Record ' + (index + 1), 'Record ID: ' + relatedRecord.id + ', Identifier: ' + relatedRecord.record.getValue(recordConfig.identifierField || 'id'));
                createOrUpdateKitRelatedRecord(kitId, relatedRecord, recordConfig);
            });
            
            log.debug('Completed Record Type', recordConfig.description + ' - Processed ' + relatedRecords.length + ' records');
            
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
            
            log.debug('Searching for Related Records', 'Item ID: ' + itemId + ', Record Type: ' + recordConfig.recordType + ', Base Item Field: ' + recordConfig.baseItemField);
            
            var relatedRecordSearch = search.create({
                type: recordConfig.recordType,
                filters: [
                    [recordConfig.baseItemField, 'is', itemId]
                ],
                columns: [
                    'internalid',
                    recordConfig.identifierField || 'internalid' // Include sequence field in search results for debugging
                ]
            });

            var searchResults = relatedRecordSearch.run().getRange({
                start: 0,
                end: 1000
            });

            log.debug('Search Results Found', 'Found ' + searchResults.length + ' records in search');

            searchResults.forEach(function(result, index) {
                var recordId = result.getValue('internalid');
                var sequenceValue = recordConfig.identifierField ? result.getValue(recordConfig.identifierField) : 'N/A';
                
                log.debug('Loading Record ' + (index + 1), 'Record ID: ' + recordId + ', Identifier: ' + sequenceValue);
                
                // Load the full record to get all field values
                var fullRecord = record.load({
                    type: recordConfig.recordType,
                    id: recordId
                });
                
                relatedRecords.push({
                    id: recordId,
                    record: fullRecord
                });
                
                log.debug('Loaded Record ' + (index + 1), 'Successfully loaded record ID: ' + recordId);
            });

            log.debug('Total Records Loaded', 'Successfully loaded ' + relatedRecords.length + ' records for Item ID: ' + itemId);
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
            var sequenceValue = recordConfig.identifierField ? sourceRecord.getValue(recordConfig.identifierField) : 'N/A';
            
            log.debug('Processing Kit Record', 'Kit ID: ' + kitId + ', Source Record ID: ' + sourceRecordData.id + ', Identifier: ' + sequenceValue);
            
            // Check if a related record already exists for this kit
            var existingRecord = findExistingKitRelatedRecord(kitId, sourceRecord, recordConfig);
            
            if (existingRecord) {
                log.debug('Found Existing Record', 'Existing Record ID: ' + existingRecord + ' for Kit ID: ' + kitId + ', Identifier: ' + sequenceValue);
                // Update existing record
                updateExistingRelatedRecord(existingRecord, sourceRecord, recordConfig);
                log.debug('Updated Existing Record', recordConfig.description + ' ID: ' + existingRecord + ', Identifier: ' + sequenceValue);
            } else {
                log.debug('No Existing Record Found', 'Creating new record for Kit ID: ' + kitId + ', Identifier: ' + sequenceValue);
                // Create new record
                var newRecordId = createNewRelatedRecord(kitId, sourceRecord, recordConfig);
                log.debug('Created New Record', recordConfig.description + ' ID: ' + newRecordId + ', Identifier: ' + sequenceValue);
            }
            
        } catch (e) {
            log.error('Error in createOrUpdateKitRelatedRecord', 'Kit ID: ' + kitId + ', Source Record ID: ' + sourceRecordData.id + ', Record Type: ' + recordConfig.recordType + ', Error: ' + e.message);
            // Don't throw the error - continue processing other records
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
            // First, get all related records for this kit (without sequence filtering)
            var filters = [
                [recordConfig.baseItemField, 'is', kitId]
            ];
            
            var sequenceValue = null;
            if (recordConfig.identifierField) {
                sequenceValue = sourceRecord.getValue(recordConfig.identifierField);
                log.debug('Looking for Identifier', 'Kit ID: ' + kitId + ', Target Identifier: ' + sequenceValue);
            }
            
            log.debug('Search Filters (No Identifier)', 'Kit ID: ' + kitId + ', Filters: ' + JSON.stringify(filters));
            
            var existingSearch = search.create({
                type: recordConfig.recordType,
                filters: filters,
                columns: [
                    'internalid',
                    recordConfig.identifierField || 'internalid' // Include identifier field in search results for debugging
                ]
            });

            var results = existingSearch.run().getRange({ start: 0, end: 50 });
            
            log.debug('All Kit Records Found', 'Kit ID: ' + kitId + ', Found ' + results.length + ' total records');
            
            // Log all found records for debugging
            results.forEach(function(result, index) {
                var foundId = result.getValue('internalid');
                var foundSequence = recordConfig.identifierField ? result.getValue(recordConfig.identifierField) : 'N/A';
                log.debug('Kit Record ' + (index + 1), 'Record ID: ' + foundId + ', Identifier: ' + foundSequence);
            });
            
            // If no sequence field, return the first record (or null if none found)
            if (!recordConfig.identifierField || !sequenceValue) {
                var returnValue = results.length > 0 ? results[0].getValue('internalid') : null;
                log.debug('No Sequence Matching', 'Returning first record: ' + returnValue);
                return returnValue;
            }
            
            // Manual filtering by sequence - find matching record
            var matchingRecord = null;
            for (var i = 0; i < results.length; i++) {
                var result = results[i];
                var foundSequence = result.getValue(recordConfig.identifierField);
                
                log.debug('Sequence Comparison', 'Comparing - Target: "' + sequenceValue + '" vs Found: "' + foundSequence + '" (Type: ' + typeof sequenceValue + ' vs ' + typeof foundSequence + ')');
                
                // Convert both to strings for comparison to handle type mismatches
                if (String(foundSequence) === String(sequenceValue)) {
                    matchingRecord = result.getValue('internalid');
                    log.debug('Sequence Match Found', 'Record ID: ' + matchingRecord + ', Identifier: ' + foundSequence);
                    break;
                }
            }
            
            if (!matchingRecord) {
                log.debug('No Identifier Match', 'Kit ID: ' + kitId + ', Target Identifier: ' + sequenceValue + ' - No matching record found');
            }
            
            return matchingRecord;
            
        } catch (e) {
            log.error('Error in findExistingKitRelatedRecord', 'Kit ID: ' + kitId + ', Error: ' + e.message);
            return null;
        }
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

            // Copy only the specified fields from source record
            recordConfig.fieldsToSync.forEach(function(fieldId) {
                try {
                    var fieldValue = sourceRecord.getValue(fieldId);
                    if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
                        newRecord.setValue({
                            fieldId: fieldId,
                            value: fieldValue
                        });
                        log.debug('Copied Field', 'Field: ' + fieldId + ', Value: ' + fieldValue);
                    }
                } catch (fieldError) {
                    log.error('Error copying field', 'Field ID: ' + fieldId + ', Error: ' + fieldError.message);
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
            
            // Update only the specified fields
            recordConfig.fieldsToSync.forEach(function(fieldId) {
                try {
                    var sourceValue = sourceRecord.getValue(fieldId);
                    var existingValue = existingRecord.getValue(fieldId);
                    
                    if (sourceValue !== existingValue && sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
                        existingRecord.setValue({
                            fieldId: fieldId,
                            value: sourceValue
                        });
                        hasChanges = true;
                        log.debug('Updated Field', 'Field: ' + fieldId + ', Old Value: ' + existingValue + ', New Value: ' + sourceValue);
                    }
                } catch (fieldError) {
                    log.error('Error updating field', 'Field ID: ' + fieldId + ', Error: ' + fieldError.message);
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

    function getRequiredUpdateFields(itemRecord){
        try {
            // Retrieve the internal ID of the record category
            var categoryId = itemRecord.getValue({ fieldId: 'class' });
            var categoryText = itemRecord.getText({ fieldId: 'class' });

            log.audit('getRequiredUpdateFields', 'Source Category ID: ' + categoryId + ' (' + categoryText + '), Type: ' + typeof categoryId);

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

            log.audit('Field Mapping Search', 'Found ' + searchResults.length + ' mappings for source category ' + categoryId);

            // Retrieve the desired column values from the search results
            var fieldsToUpdate = [];
            var targetCategories = {};
            searchResults.forEach(function(result, index) {
                var targetCategory = result.getValue({
                    name: 'custrecord_hyc_item_field_sync_tar_cat'
                });
                var sourceFieldId = result.getValue({
                    name: 'custrecord_hyc_item_fields_sync_src_id'
                });
                var targetFieldId = result.getValue({
                    name: 'custrecord_hyc_item_fields_sync_tar_id'
                });

                // Track unique target categories
                targetCategories[targetCategory] = (targetCategories[targetCategory] || 0) + 1;

                // Log first mapping to show data types
                if (index === 0) {
                    log.audit('Sample Mapping', 'Target Category: ' + targetCategory + ' (type: ' + typeof targetCategory + '), Source: ' + sourceFieldId + ', Target: ' + targetFieldId);
                }

                // Push an object containing both source and target field IDs
                fieldsToUpdate.push({
                    targetCategory: targetCategory,
                    source: sourceFieldId,
                    target: targetFieldId
                });
            });

            // Log summary of target categories
            var targetCatSummary = Object.keys(targetCategories).map(function(cat) {
                return cat + ':' + targetCategories[cat];
            }).join(', ');
            log.audit('Target Categories Summary', targetCatSummary || 'No mappings found');

            return fieldsToUpdate;

        } catch (error) {
            log.error({
                title: 'Error retrieving Item Fields Sync Map data',
                details: error
            });
        }

    }

function updateSharedFields(fieldsToUpdate, kitRecord, inventoryItemRecord) {
        var kitCategoryId = kitRecord.getValue({ fieldId: 'class' });
        var updateCount = 0;
        var skipCount = 0;
        var mismatchCount = 0;

        // Loop through the array of field IDs and update corresponding fields on the Kit/Package record
        fieldsToUpdate.forEach(function(field, index) {
            // Inventory Item Source Field
            var itemFieldValue = inventoryItemRecord.getValue({ fieldId: field.source });

            // Check if the target Category is the same as the Kit item
            // Convert both to strings for comparison to handle type mismatches
            var kitCatStr = String(kitCategoryId);
            var targetCatStr = String(field.targetCategory);

            if (kitCatStr === targetCatStr) {
                // Update the Kit target field only when it's being updated to avoid bombarding the audit/trail
                var kitFieldValue = kitRecord.getValue({ fieldId: field.target });
                if (itemFieldValue && itemFieldValue != kitFieldValue) {
                    log.audit('Field Update', 'Field: ' + field.source + ' -> ' + field.target + ', Value: "' + itemFieldValue + '" (was: "' + kitFieldValue + '")');
                    kitRecord.setValue({ fieldId: field.target, value: itemFieldValue });
                    updateCount++;
                } else {
                    skipCount++;
                    // Only log first few skips to avoid log spam
                    if (skipCount <= 3) {
                        log.debug('Field Skipped', 'Field: ' + field.source + ' -> ' + field.target + ', Reason: ' + (itemFieldValue ? 'unchanged' : 'empty source value'));
                    }
                }
            } else {
                mismatchCount++;
                // Log first category mismatch for debugging
                if (mismatchCount === 1) {
                    log.audit('Category Mismatch Example', 'Kit Category: ' + kitCatStr + ' (type: ' + typeof kitCategoryId + '), Target Category: ' + targetCatStr + ' (type: ' + typeof field.targetCategory + ')');
                }
            }
        });

        log.audit('Update Summary', 'Updated: ' + updateCount + ', Skipped (unchanged/empty): ' + skipCount + ', Category Mismatch: ' + mismatchCount + ' of ' + fieldsToUpdate.length + ' total mappings');
    }

    // Reschedule the script to process remaining records
    // Note: Fixed function signature - was receiving 3 args but only accepting 2
    function rescheduleScript(itemRecordOrId, itemId, start) {
        try {
            // Handle both old (3 arg) and potential new (2 arg) calls
            var actualItemId = itemId || itemRecordOrId;
            var actualStart = start || itemId;

            var scriptTask = task.create({
                taskType: task.TaskType.SCHEDULED_SCRIPT,
                scriptId: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                params: {
                    custscript_item_id: actualItemId,
                    custscript_start_index: actualStart
                }
            });

            var taskId = scriptTask.submit();
            log.audit('Rescheduled Script', 'Task ID: ' + taskId + ', Item ID: ' + actualItemId + ', Start Index: ' + actualStart);
        } catch (e) {
            log.error('Error Rescheduling Script', e.message);
        }
    }

    return {
        execute: execute
    };
});