/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/record', 'N/search', 'N/log'], function(record, search, log) {
    function onRequest(context) {
        if (context.request.method === 'GET') {
            // Create a search to find records with the specified condition
            var customRecordSearch = search.create({
                type: 'customrecord_celigo_shopify_shpfitem_map', // Replace with your custom record type ID
                filters: [
                    ['custrecord_celigo_shpf_siim_productid', 'isempty', ''] // Replace with your field ID
                ],
                columns: ['internalid']
            });

            var searchResult = customRecordSearch.run();
            var deletedCount = 0;

            searchResult.each(function(result) {
                try {
                    var recordId = result.getValue({ name: 'internalid' });
                    record.delete({
                        type: 'customrecord_celigo_shopify_shpfitem_map', // Replace with your custom record type ID
                        id: recordId
                    });
                    deletedCount++;
                    log.debug('Record Deleted', 'Record ID: ' + recordId);
                } catch (e) {
                    log.error('Error Deleting Record', 'Record ID: ' + recordId + ' - ' + e.message);
                }
                return true; // Continue to next result
            });

            // Send response back
            context.response.write('Deleted ' + deletedCount + ' records where custrecord_celigo_shpf_siim_productid is empty.');
        }
    }

    return {
        onRequest: onRequest
    };
});