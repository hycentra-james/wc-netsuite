/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/http', 'SuiteScripts/Concentrus/PackShipTemplate/Con_Lib_Item_Fulfillment_Package.js'],
    function (record, search, http, itemFulfillmentPackage) {

        function afterSubmit(context) {
            log.debug('context.type', context.type)
            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.XEDIT &&
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            // Replace 'custbody_your_custom_field' with your actual custom field ID
            let customFieldId = 'custbody_pro_number';

            let newRecord = context.newRecord;
            let oldRecord = context.oldRecord;

            // Get the current value of the custom field
            let newValue = newRecord.getValue({
                fieldId: customFieldId
            });

            // Get the previous value (will be null for CREATE operations)
            let oldValue = null;
            if (oldRecord) {
                oldValue = oldRecord.getValue({
                    fieldId: customFieldId
                });
            }

            // Check if field was updated from empty to having a value
            let wasEmpty = !oldValue || oldValue === '' || oldValue === null;
            let hasValue = newValue && newValue !== '' && newValue !== null;

            log.debug('values', {oldValue, newValue, wasEmpty, hasValue})
            if (wasEmpty && hasValue) {
                log.debug({
                    title: 'Pro Number Updated',
                    details: 'Field ' + customFieldId + ' changed from empty to: ' + newValue
                });

                // Make HTTP request
                // makeHttpRequest(newRecord.id);
                updatePackage(newRecord.id);
            }
        }

        function updatePackage(salesOrderId) {
            let searchObj = search.create({
                type: 'itemfulfillment',
                filters: [
                    ['type', 'anyof', 'ItemShip'],
                    "AND",
                    ['createdfrom', 'anyof', salesOrderId],
                    "AND",
                    ['mainline', 'is', 'T']
                ],
                columns: [
                    {name: 'internalid'}
                ]
            });
            let searchResultCount = searchObj.runPaged().count;
            log.debug("searchObj result count", searchResultCount);
            let results = [];
            searchObj.run().each(function (result) {
                results.push(result.id);
                return true;
            });
            if (results.length === 0) {
                throw new Error('No item fulfillment found for sales order ' + salesOrderId);
            }
            let itemFulfillmentId = results[0]
            itemFulfillmentPackage.processFullLtl(itemFulfillmentId);
        }

        function safelyExecute(func, context) {
            try {
                return func(context)
            } catch (e) {
                log.error(`error in ${func.name}`, e.toString())
            }
        }

        return {
            afterSubmit: (context) => safelyExecute(afterSubmit, context),
        }
    })
