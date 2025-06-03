/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/record', 'N/log', 'N/ui/serverWidget', 'N/search'], function(record, log, serverWidget, search) {

    function onRequest(context) {
        if (context.request.method === 'GET') {
            var formIds = [199, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316];
            var recordType = 'inventoryitem'; // Adjust this to your specific record type

            formIds.forEach(function(formId) {
                logFormFields(recordType, formId);
            });

            context.response.write('Check the script logs for the list of fields.');
        }
    }

    function logFormFields(recordType, formId) {
        // Create a temp record witht the formId
        var rec = record.create({
            type: recordType,
            isDynamic: true,
            defaultValues: { customform: formId }
        });

        var searchResults = search.create({
            type: recordType,
            filters: [
                ['formulanumeric: CASE WHEN {form} = ' + formId + ' THEN 1 ELSE 0 END', 'equalto', 1]
            ],
            columns: ['internalid']
        }).run().getRange({
            start: 0,
            end: 1
        });

        if (searchResults.length > 0) {
            var rec = record.load({
                type: recordType,
                id: searchResults[0].getValue('internalid'),
                isDynamic: true
            });

            var fields = rec.getFields();
            log.debug('Form ID: ' + formId, 'Total Fields: ' + fields.length);

            fields.forEach(function(fieldId) {
                if (fieldId.startsWith('custitem')) {
                    var field = rec.getField({ fieldId: fieldId });
                    if (field) {
                        log.debug({
                            title: 'Field Details for Form ID ' + formId,
                            details: 'Field ID: ' + fieldId + ', Label: ' + field.label + ', Type: ' + field.type
                        });
                    }
                }
            });
        } else {
            log.debug('Form ID: ' + formId, 'No records found with this form.');
        }
    }

    return {
        onRequest: onRequest
    };
});
