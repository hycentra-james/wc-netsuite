/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(['N/log', 'N/search', 'N/record', 'N/error', 'N/file'], function(log, search, record, error, file) {

    /**
     * The input stage of the Map/Reduce script.
     *
     * @param {Object} context - Object containing the script's context and settings.
     * @param {Object} context.inputs - Object containing input data.
     */
    function getInputData(context) {
        // Replace with the internal ID of your CSV file in the file cabinet
        var fileId = '2384818';
        
        log.debug('DEBUG', 'getInputData start');

        // Load the CSV file
        var csvFile = file.load({
            id: fileId
        });

        // Read and parse the CSV data
        var csvData = csvFile.getContents();
        var parsedData = parseCSV(csvData);

        log.debug('DEBUG', 'getInputData end');
        log.debug('DEBUG', 'parsedData.length = ' + parsedData.length);
        log.debug('DEBUG', 'parsedData = ' + parsedData);

        // Return parsed data as input for map stage
        return parsedData;
    }

    /**
     * The map stage of the Map/Reduce script.
     *
     * @param {Object} context - Object containing the script's context and settings.
     * @param {Object} context.mapContext - Object containing mapping functions and settings.
     */
    function map(context) {
        log.debug('DEBUG', 'map start');
        log.debug('DEBUG', 'context.value = ' + context.value);
        // Process each key-value pair from the getInputData results
        var entry = JSON.parse(context.value);
        var fulfillmentId = entry.fulfillmentId;
        var associateName = entry.associateName;
        var associateId = findAssociateInternalIdByName(associateName);

        log.debug('DEBUG', 'fulfillmentId = ' + fulfillmentId);
        log.debug('DEBUG', 'associateName = ' + associateName);
        log.debug('DEBUG', 'associateId = ' + associateId);

        // Load the Item Fulfillment record
        var fulfillmentRecord = record.load({
            type: record.Type.ITEM_FULFILLMENT,
            id: fulfillmentId
        });

        // Set the custom field value on the Item Fulfillment record
        fulfillmentRecord.setValue({
            fieldId: 'custbody_hyc_wh_associate',
            value: associateId
        });

        // Save the Item Fulfillment record
        fulfillmentRecord.save();

        log.debug('DEBUG', 'map end');
    }

    /**
     * The reduce stage of the Map/Reduce script.
     *
     * @param {Object} context - Object containing the script's context and settings.
     * @param {Object} context.reduceContext - Object containing reducing functions and settings.
     
    function reduce(context) {
        log.debug('DEBUG', 'reduce start');
        // Aggregate the key-value pairs from the map stage
        var fulfillmentId = context.key;
        var associateId = context.values[0];

        log.debug('DEBUG', 'reduce end');
    }
    */

    /**
     * The summarize stage of the Map/Reduce script.
     *
     * @param {Object} context - Object containing the script's context and settings.
     * @param {Object} context.summary - Object containing summary information.
     */
    function summarize(context) {
        // Implement logic to perform any final actions or record updates
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

            if (headers.length == 3) {
                entry.fulfillmentId = values[1];
                entry.associateName = values[2];

                log.debug('DEBUG', 'entry.fulfillmentId = ' + entry.fulfillmentId);
                log.debug('DEBUG', 'entry.associateName = ' + entry.associateName);
                parsedData.push(entry);
            }
        }

        //return JSON.stringify(parsedData);
        return parsedData;
    }

    function findAssociateInternalIdByName(associateName) {
        var customListId = 'customlist_hyc_wh_associate_lis';

        var customListSearch = search.create({
            type: customListId,
            filters: [
                search.createFilter({
                    name: 'name',
                    operator: search.Operator.IS,
                    values: [associateName]
                })
            ],
            columns: ['internalid']
        });

        var searchResults = customListSearch.run().getRange({
            start: 0,
            end: 1
        });

        if (searchResults.length > 0) {
            return searchResults[0].getValue({
                name: 'internalid'
            });
        } else {
            return null;
        }
    }

    return {
        getInputData: getInputData,
        map: map,
        // reduce: reduce,
        summarize: summarize
    };
});
