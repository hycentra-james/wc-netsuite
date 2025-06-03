/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */

// This script updates LB Header data for multiple Sales Orders by modifying specific fields in existing JSON data.
// It replaces: ShipVia = "MCC", lineHaul = "MCC", serviceLevel = "UNSP"

define(['N/record', 'N/log'], function (record, log) {

    function execute(context) {
        try {
            // Array of Sales Order Internal IDs to update
            var salesOrderIds = [
                10065592
                // Add more Sales Order IDs here as needed
            ];

            var processedCount = 0;
            var errorCount = 0;

            log.audit('Processing Started', 'Total Sales Orders to process: ' + salesOrderIds.length);

            // Process each Sales Order
            for (var i = 0; i < salesOrderIds.length; i++) {
                var salesOrderId = salesOrderIds[i];

                try {
                    updateSalesOrderFields(salesOrderId, i + 1);
                    processedCount++;

                } catch (error) {
                    log.error('Error processing Sales Order ID: ' + salesOrderId, error);
                    errorCount++;
                }
            }

            log.audit('Processing Completed', 'Processed: ' + processedCount + ', Errors: ' + errorCount);

        } catch (e) {
            log.error('Error in main execution', e);
        }
    }

    function updateSalesOrderFields(salesOrderId, recordNumber) {
        try {
            // Load the Sales Order record
            var salesOrder = record.load({
                type: record.Type.SALES_ORDER,
                id: salesOrderId
            });

            // Get the existing custbody_lb_headerdata value
            var existingHeaderData = salesOrder.getValue({
                fieldId: 'custbody_lb_headerdata'
            });

            if (!existingHeaderData) {
                log.error('No Header Data Found', 'Sales Order ID: ' + salesOrderId + ' - custbody_lb_headerdata is empty');
                throw new Error('No existing header data found');
            }

            // Parse the existing JSON string
            var headerDataObject;
            try {
                headerDataObject = JSON.parse(existingHeaderData);
            } catch (parseError) {
                log.error('JSON Parse Error', 'Sales Order ID: ' + salesOrderId + ' - Invalid JSON: ' + existingHeaderData);
                throw new Error('Failed to parse JSON: ' + parseError.message);
            }

            // Update the specific fields
            var updated = false;

            // Update ShipVia in packSlipFields
            if (headerDataObject.packSlipFields && headerDataObject.packSlipFields.ShipVia !== 'MCC') {
                headerDataObject.packSlipFields.ShipVia = 'MCC';
                updated = true;
            }

            // Update lineHaul and serviceLevel in shippingLabelFields
            if (headerDataObject.shippingLabelFields) {
                if (headerDataObject.shippingLabelFields.lineHaul !== 'MCC') {
                    headerDataObject.shippingLabelFields.lineHaul = 'MCC';
                    updated = true;
                }
                if (headerDataObject.shippingLabelFields.serviceLevel !== 'UNSP') {
                    headerDataObject.shippingLabelFields.serviceLevel = 'UNSP';
                    updated = true;
                }
            }

            // Only save if we made changes
            if (updated) {
                // Convert back to JSON string
                var updatedHeaderData = JSON.stringify(headerDataObject);

                // Set the updated value
                salesOrder.setValue({
                    fieldId: 'custbody_lb_headerdata',
                    value: updatedHeaderData
                });

                // Save the record
                var savedRecordId = salesOrder.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

                log.audit('Sales Order Updated', 'Record ' + recordNumber + ' - Sales Order ID: ' + savedRecordId + ' - Fields updated');
            } else {
                log.audit('No Changes Needed', 'Record ' + recordNumber + ' - Sales Order ID: ' + salesOrderId + ' - All fields already have correct values');
            }

        } catch (e) {
            log.error('Error updating Sales Order ID: ' + salesOrderId + ' (Record ' + recordNumber + ')', e);
            throw e;
        }
    }

    return {
        execute: execute
    };

});
