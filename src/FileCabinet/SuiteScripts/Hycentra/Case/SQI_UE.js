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
        try {
            var newRecord = context.newRecord;
            var eventType = context.type; // create | edit | delete

            log.debug('afterSubmit', 'Starting afterSubmit - Event Type: ' + eventType);

            // Only run for create or edit
            if (eventType !== context.UserEventType.CREATE && eventType !== context.UserEventType.EDIT) {
                log.debug('afterSubmit', 'Skipping - Event type is not CREATE or EDIT');
                return;
            }

            var caseId = newRecord.getValue({ fieldId: 'custrecord_hyc_sqi_case' });
            log.debug('afterSubmit', 'Case ID from SQI record: ' + caseId);
            
            if (!caseId) {
                log.debug('afterSubmit', 'No case ID found - exiting');
                return;
            }

            // Search for any SQI records referencing this case
            log.debug('afterSubmit', 'Searching for SQI records with case ID: ' + caseId);
            var sqiCount = 0;
            var sqiSearch = search.create({
                type: SQI_RECORD_ID,
                filters: [
                    ['custrecord_hyc_sqi_case', 'anyof', caseId]
                ],
                columns: [search.createColumn({name: 'internalid', summary: 'COUNT'})]
            });
            
            log.debug('afterSubmit', 'Search created, running search...');
            var searchResult = sqiSearch.run().getRange({ start: 0, end: 1 });
            log.debug('afterSubmit', 'Search results: ' + JSON.stringify(searchResult));
            
            if (searchResult && searchResult.length > 0) {
                sqiCount = parseInt(searchResult[0].getValue({ name: 'internalid', summary: 'COUNT' }), 10) || 0;
                log.debug('afterSubmit', 'SQI Count found: ' + sqiCount);
            } else {
                log.debug('afterSubmit', 'No search results returned');
            }

            if (sqiCount > 0) {
                log.debug('afterSubmit', 'SQI count > 0, proceeding to update case checkbox');
                
                // Set the checkbox on the case
                log.debug('afterSubmit', 'Loading case record with ID: ' + caseId);
                var caseRecord = record.load({
                    type: record.Type.SUPPORT_CASE,
                    id: caseId,
                    isDynamic: false
                });
                
                log.debug('afterSubmit', 'Case record loaded successfully');
                
                // Check current value before setting
                var currentValue = caseRecord.getValue({ fieldId: 'custevent_hyc_sqi_is_created' });
                log.debug('afterSubmit', 'Current checkbox value: ' + currentValue);
                
                caseRecord.setValue({
                    fieldId: 'custevent_hyc_sqi_is_created',
                    value: true
                });
                
                log.debug('afterSubmit', 'Checkbox value set to true, saving record...');
                var savedId = caseRecord.save({ enableSourcing: false, ignoreMandatoryFields: true });
                log.debug('afterSubmit', 'Case record saved successfully with ID: ' + savedId);
                
                // Verify the save by reloading and checking the value
                var verifyRecord = record.load({
                    type: record.Type.SUPPORT_CASE,
                    id: caseId,
                    isDynamic: false
                });
                var newValue = verifyRecord.getValue({ fieldId: 'custevent_hyc_sqi_is_created' });
                log.debug('afterSubmit', 'Verification - New checkbox value after save: ' + newValue);
                
            } else {
                log.debug('afterSubmit', 'SQI count is 0 or less, not updating case checkbox');
            }
        } catch (e) {
            log.error({
                title: 'afterSubmit error',
                details: e
            });
        }
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