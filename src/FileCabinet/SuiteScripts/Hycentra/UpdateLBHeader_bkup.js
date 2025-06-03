/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */

// This script is used to update the LB Header data for the Sales Order.

define(['N/record', 'N/log'], function (record, log) {

    function execute(context) {
        try {
            // Define the internal ID of the Sales Order
            var salesOrderId = 10058254; // Change this to your Sales Order internal ID

            // Load the Sales Order record
            var salesOrder = record.load({
                type: record.Type.SALES_ORDER,
                id: salesOrderId
            });

            // Set the custom field value
            salesOrder.setValue({
                fieldId: 'custbody_lb_headerdata', // Custom field ID
                value: "{\"packSlipFields\":{\"OrderedBy\":{\"CompanyName\":\"Phong Luu\",\"AddressCode\":\"8119\",\"ContactType\":0,\"ExtendedAttributes\":[{\"Name\":\"N101\",\"Value\":\"SO\"},{\"Name\":\"N103 - Order By Address Code Qualifier\",\"Value\":\"93\"}]},\"ShipTo\":{\"CompanyName\":\"Tran Luu\",\"Address1\":\"12137 US Highway 19\",\"City\":\"Hudson\",\"State\":\"FL\",\"Country\":\"US\",\"Zip\":\"34667\",\"Phone\":\"7145926288\",\"ContactType\":0,\"ExtendedAttributes\":[{\"Name\":\"N101\",\"Value\":\"ST\"},{\"Name\":\"PER - Ship To Address Contact Qualifier\",\"Value\":\"RS\"},{\"Name\":\"PER09_RS\",\"Value\":\"2\"}]},\"CustomerOrderNumber\":\"WG90270716\",\"PurchaseOrderNumber\":\"73947851\",\"Date\":\"2025-05-28T00:00:00\",\"ShipVia\":\"MCC\",\"Warehouse\":\"CA Ontario\",\"Message\":\"\"},\"shippingLabelFields\":{\"orderType\":\"VEND\",\"marketId\":null,\"lastMile\":null,\"lineHaul\":\"MCC\",\"customerTracking\":null,\"serviceLevel\":\"UNSP\",\"markForAddress\":{\"ContactType\":0}}}"
            });

            // Save the record
            var savedRecordId = salesOrder.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });

            log.audit('Sales Order Updated', 'Updated Sales Order ID: ' + savedRecordId);

        } catch (e) {
            log.error('Error updating Sales Order', e);
        }
    }

    return {
        execute: execute
    };

});
