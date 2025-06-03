/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/search', 'N/log', 'N/format'], function(serverWidget, search, log, format) {

    function onRequest(context) {
        if (context.request.method === 'GET') {
            // Create the form
            var form = serverWidget.createForm({ title: 'Retrieve Old Pricing' });

            // Add start date field
            form.addField({
                id: 'custpage_startdate',
                type: serverWidget.FieldType.DATE,
                label: 'Start Date'
            });

            // Add a submit button
            form.addSubmitButton({ label: 'Retrieve Pricing' });

            // Write the form to the response
            context.response.writePage(form);

        } else {
            try {
                // Get the date range from the request parameters
                var startDate = context.request.parameters.custpage_startdate;
                var endDate = context.request.parameters.custpage_enddate;

                // Format the date strings to NetSuite format
                var formattedStartDate = format.format({
                    value: format.parse({ value: startDate, type: format.Type.DATE }),
                    type: format.Type.DATE
                });

                var results = [];

                var systemnoteSearchObj = search.create({
                    type: "systemnote",
                    filters:
                    [
                       ["date","on",formattedStartDate], 
                       "AND", 
                       ["name","anyof","9998"], 
                       "AND", 
                       ["context","anyof","CSV"], 
                       "AND", 
                       ["field","anyof","INVTITEM.PRICELIST"]
                    ],
                    columns:
                    [
                       "record",
                       "name",
                       "date",
                       "context",
                       "type",
                       "field",
                       "oldvalue",
                       "newvalue"
                    ]
                 });
                 /*
                 var searchResultCount = systemnoteSearchObj.runPaged().count;
                 log.debug("systemnoteSearchObj result count",searchResultCount);
                 systemnoteSearchObj.run().each(function(result){
                    // .run().each has a limit of 4,000 results
                    return true;
                 });
                 */

                log.debug('System Notes Results', JSON.stringify(results));

                systemnoteSearchObj.run().each(function(result) {
                    results.push({
                        record: result.getValue('record'),
                        name: result.getValue('name'),
                        date: result.getValue('date'),
                        context: result.getValue('context'),
                        type: result.getValue('type'),
                        field: result.getValue('field'),
                        oldValue: result.getValue('oldvalue'),
                        newValue: result.getValue('newvalue'),
                    });
                    return true;
                });

                // Log the results
                log.debug('System Notes Results', JSON.stringify(results));

                // Return the results as JSON
                context.response.setHeader('Content-Type', 'application/json');
                context.response.write(JSON.stringify(results));

            } catch (e) {
                log.error({
                    title: 'Error processing request',
                    details: e
                });
                context.response.write('Error processing request: ' + e.message);
            }
        }
    }

    return {
        onRequest: onRequest
    };
});