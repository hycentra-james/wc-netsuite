/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define([
    'N/ui/serverWidget',   // add/remove modules as needed
    'N/runtime',
    'N/record',
    'N/log',
    'N/search',
    './SQI_helper'
], function (serverWidget, runtime, record, log, search, helper) {

    // ────────────────────────────
    // CONSTANTS
    // ────────────────────────────
    var SQI_RECORD_ID = 'customrecord_hyc_sqi_record';  // <-- replace with your record type

    // ────────────────────────────
    // beforeLoad()
    // ────────────────────────────
    function beforeLoad(context) {
        try {
            var newRecord = context.newRecord;
            var eventType = context.type;  // create | edit | view | copy

            if (eventType === context.UserEventType.CREATE) {
                tryLookupOrderFromCase(newRecord);
            }

        } catch (e) {
            log.error({
                title: 'beforeLoad error',
                details: e
            });
        }
    }

    function tryLookupOrderFromCase(currentRecord) {
        var caseId = currentRecord.getValue({ fieldId: 'custrecord_hyc_sqi_case' });

        if (!caseId) {
            return; // Exit if no case ID is provided
        }

        try {
            // Load the Case record
            var caseRecord = record.load({
                type: record.Type.SUPPORT_CASE,
                id: caseId,
                isDynamic: false
            });

            if (!caseRecord) {
                log.error('Case Not Found', 'Could not load case with ID: ' + caseId);
                return;
            }

            // Get Customer Provided SO/PO number from the case
            var customerProvidedSoPoNo = caseRecord.getValue({ fieldId: 'custeventcrmfldorderpono' });

            // Try to find the sales order using SO or PO number
            if (customerProvidedSoPoNo) {
                helper.populateOrder(customerProvidedSoPoNo, currentRecord, 'custrecord_hyc_sqi_sales_order');
                
                // Check if order is being populated
                var orderId = currentRecord.getValue({ fieldId: 'custrecord_hyc_sqi_sales_order' });
                if (orderId) {
                    // If order is being populated, we'll try to populate the item info
                    helper.tryPopulateSingleItemOrder(orderId, currentRecord);
                }
            }
        } catch (e) {
            log.error('Error loading case', e.message);
        }
    }



    // ────────────────────────────
    // beforeSubmit()
    // ────────────────────────────
    function beforeSubmit(context) {
        // put validation or defaulting logic here
    }

    // ────────────────────────────
    // afterSubmit()
    // ────────────────────────────
    function afterSubmit(context) {
        // put follow-up logic here
    }

    // ────────────────────────────
    // EXPORTS
    // ────────────────────────────
    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit,
        tryLookupOrderFromCase: tryLookupOrderFromCase
    };

});