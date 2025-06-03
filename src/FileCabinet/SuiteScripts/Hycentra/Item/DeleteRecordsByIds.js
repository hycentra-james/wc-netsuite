/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/log'], function(record, log) {

    //const recordType = 'customrecord_hyc_record_product_media';
    const recordType = 'customrecord_celigo_shopify_shpfitem_map';
    //const recordType = record.Type.CUSTOMER;
    const idsToDel = [
        2990,2991,2992,2993,2994,2995,2996,2997,3026,3027,3028,3029,3030,3031,3032,3033,3034,3035,2591,2377,2378,2379,2380,2381,2382,2383
    ];

    // Step 1: Provide the list of record IDs as input data
    function getInputData() {
        return idsToDel;
    }

    // Step 2: Handle each record ID using the Map stage
    function map(context) {
        var recordId = context.value;
        try {
            record.delete({
                type: recordType,
                id: recordId
            });

            log.debug("Success", "Record with ID " + recordId + " has been deleted.");
        } catch (e) {
            log.error("Failed to Delete Record", "Record ID: " + recordId + ". Error: " + e.message);
        }
    }

    // Step 3: Define empty reduce and summarize functions
    function reduce(context) {
        // Not used for this operation
    }

    function summarize(summary) {
        // Log summary of the script run
        log.audit("Map/Reduce Script Complete", "Total records processed: " + summary.inputSummary.usage);
        if (summary.mapSummary.errors.length > 0) {
            summary.mapSummary.errors.forEach(function(key, error) {
                log.error("Map Error: " + key, error);
            });
        }
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});