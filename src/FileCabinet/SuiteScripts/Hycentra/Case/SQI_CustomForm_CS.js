/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */
define(['N/record', 'N/search', 'N/log', 'N/format', '../moment.min.js', './SQI_helper'],
    function (record, search, log, format, moment, helper) {

        var pageMode;
        function pageInit(context) {
            pageMode = context.mode;
            var currentRecord = context.currentRecord;

            currentRecord.getField({fieldId: 'custrecord_hyc_sqi_sopono_search'}).isDisabled = (pageMode !== 'create');
            currentRecord.getField({fieldId: 'custrecord_hyc_sqi_replace_sopono_search'}).isDisabled = (pageMode !== 'create');
        }

        function fieldChanged(context) {
            var currentRecord = context.currentRecord;

            // Check if the field changed is the reference field you're interested in
            if (pageMode === 'create' && 
                    (
                        context.fieldId === 'custrecord_hyc_sqi_replace_sopono_search' || 
                        context.fieldId === 'custrecord_hyc_sqi_sopono_search' ||
                        context.fieldId === 'custrecord_hyc_sqi_issue_item'
                    )
                ) {
                var lookupVal = currentRecord.getValue({
                    fieldId: context.fieldId
                });

                // Populate the order from Order Ref or Sales Order No
                if (lookupVal && lookupVal !== null) {
                    if (context.fieldId === 'custrecord_hyc_sqi_replace_sopono_search') {
                        handleReplaceSOSearch(lookupVal, currentRecord);
                    } else if (context.fieldId === 'custrecord_hyc_sqi_sopono_search') {
                        handleOriginalSOSearch(lookupVal, currentRecord);
                    } else if (context.fieldId === 'custrecord_hyc_sqi_issue_item') {
                        var salesOrderId = currentRecord.getValue({ fieldId: 'custrecord_hyc_sqi_sales_order' })
                        var itemId = currentRecord.getValue({ fieldId: 'custrecord_hyc_sqi_issue_item' });
                        if (salesOrderId && salesOrderId !== null && itemId && itemId !== null) {
                            handleIssueItemSearch(salesOrderId, itemId, currentRecord);
                        }
                    }
                }
            }
        }

        function handleOriginalSOSearch(lookupVal, currentRecord) {
            helper.populateOrder(lookupVal, currentRecord, 'custrecord_hyc_sqi_sales_order');

            // Check if order is being populated
            var orderId = currentRecord.getValue({ fieldId: 'custrecord_hyc_sqi_sales_order' });
            if (orderId) {
                // If order is being populated, we'll try to populate the item info
                helper.tryPopulateSingleItemOrder(orderId, currentRecord);
            }
        }

        function handleReplaceSOSearch(lookupVal, currentRecord) {
            try {
                // Create a search to find the Sales Order by otherrefnum
                var soRS = helper.searchSalesOrder(lookupVal);
                if (soRS && soRS.length > 0) {
                    currentRecord.setValue({
                        fieldId: 'custrecord_hyc_sqi_replacement_so',
                        value: soRS[0].getValue({ name: 'internalid' })
                    });
                    currentRecord.setValue({
                        fieldId: 'custrecord_hyc_sqi_cust_purchased_from',
                        value: soRS[0].getValue({ name: 'entity' })
                    });
                }

                if (soRS.length > 0) {
                    var soInternalId = soRS[0].getValue({ name: 'internalid' });
                    // Set Customer
                    currentRecord.setValue({
                        fieldId: 'custrecord_hyc_sqi_outbound_ship_cost',
                        value: soRS[0].getValue({ name: 'custbody_fmt_actual_shipping_cost' })
                    });
                } else {
                    alert('No Sales/Replacement Order found for reference: ' + lookupVal);
                    log.error('Sales/Replacement Order not found', 'No Sales/Replacement Order found for reference: ' + lookupVal);
                }

            } catch (e) {
                log.error('Error', e.message);
            }
        }

        function handleIssueItemSearch(salesOrderId, itemId, currentRecord) {
            helper.populateItemInfo(salesOrderId, itemId, currentRecord);
        }

        return {
            pageInit: pageInit,
            fieldChanged: fieldChanged
        };

    });
