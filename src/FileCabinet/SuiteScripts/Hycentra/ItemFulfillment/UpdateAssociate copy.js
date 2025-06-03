/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/record', 'N/file', 'N/log', 'N/search'], function(record, file, log, search) {

    function onRequest(context) {
        // Replace with the internal ID of your CSV file in the file cabinet
        var fileId = '2384818';

        try {
            // Load the CSV file
            var csvFile = file.load({
                id: fileId
            });

            // Read and parse the CSV data
            var csvData = csvFile.getContents();
            parseCSV(csvData);

            // Update Item Fulfillment records based on the CSV data
            // updateItemFulfillments(parsedData);

            log.debug('CSV File Processing Complete', 'Item Fulfillment records updated successfully');
        } catch (e) {
            log.error('Error Processing CSV File', e.message);
        }
    }

    function parseCSV(csvData) {
        // Implement your CSV parsing logic here
        // For simplicity, assuming CSV data is comma-separated with a header row
        var lines = csvData.split('\n');
        var headers = lines[0].split(',');
        var parsedData = [];

        for (var i = 1; i < lines.length; i++) {
            var values = lines[i].split(',');
            var entry = {};

            if (headers.length == 2) {
                // entry[headers[j]] = values[j];
                var fulfillmentId = values[0];
                var associateName = values[1];
                var associateId = findInternalIdByValue(associateName);

                log.debug('DEBUG', 'fulfillmentId = ' + fulfillmentId);
                log.debug('DEBUG', 'associateName = ' + associateName);
                log.debug('DEBUG', 'associateId = ' + associateId);

                var fulfillmentRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId
                });
    
                fulfillmentRecord.setValue({
                    fieldId: 'custbody_hyc_wh_associate', // Replace with the actual field ID for your custom field
                    value: associateId
                });
    
                fulfillmentRecord.save();
            }

        }
    }

    function findInternalIdByValue(targetValue) {
        var customListId = 'customlist_hyc_wh_associate_lis'; // Replace with your custom list ID
        // var targetValue = 'Miguel'; // Replace with the value you are searching for

        // Create a search to find the internal ID
        var customListSearch = search.create({
            type: customListId,
            filters: [
                search.createFilter({
                    name: 'name',
                    operator: search.Operator.IS,
                    values: [targetValue]
                })
            ],
            columns: ['internalid']
        });

        // Run the search
        var searchResults = customListSearch.run().getRange({
            start: 0,
            end: 1
        });

        // Check if there is a result
        if (searchResults.length > 0) {
            var internalId = searchResults[0].getValue({
                name: 'internalid'
            });

            log.debug('Custom List Record Found', 'Internal ID: ' + internalId);
            return internalId;
        } else {
            log.warning('Custom List Record Not Found', 'Value: ' + targetValue);
            return null;
        }
    }


    return {
        onRequest: onRequest
    };
});