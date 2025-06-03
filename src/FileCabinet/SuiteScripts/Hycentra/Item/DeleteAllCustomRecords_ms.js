/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */

define(['N/record', 'N/search'],
    function(record, search) {

        function deleteCustomRecords() {
            // Define the internal ID of the custom record type to delete
            var customRecordType = 'customrecord_hyc_record_product_media'; // Replace with your custom record type's internal ID

            // Create a search to find all records of the custom record type
            var customRecordSearch = search.create({
                type: customRecordType,
                columns: ['internalid'] // Include only the internal ID column to minimize search payload
            });

            // Run the search and process the results
            customRecordSearch.run().each(function(result) {
                var customRecordId = result.getValue({
                    name: 'internalid'
                });

                try {
                    // Delete each custom record found
                    record.delete({
                        type: customRecordType,
                        id: customRecordId
                    });

                    //log.debug('Record Deleted', 'Custom record ID ' + customRecordId + ' deleted successfully.');
                } catch (ex) {
                    log.error('Error Deleting Record', 'An error occurred while deleting custom record ID ' + customRecordId + ': ' + ex.message);
                }

                // Continue processing remaining search results
                return true;
            });
        }

        return {
            execute: deleteCustomRecords
        };

    });