/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */

define(['N/ui/serverWidget', 'N/record', 'N/log', 'N/redirect'], function(serverWidget, record, log, redirect) {
    
    /**
     * Definition of the Suitelet script trigger point.
     *
     * @param {Object} context
     * @param {ServerRequest} context.request - Encapsulation of the incoming request
     * @param {ServerResponse} context.response - Encapsulation of the server response
     * @Since 2015.2
     */
    function onRequest(context) {
        if (context.request.method === 'GET') {
            showForm(context);
        } else if (context.request.method === 'POST') {
            createSalesOrder(context);
        }
    }
    
    function showForm(context) {
        try {
            // Create the form
            var form = serverWidget.createForm({
                title: 'Create Test Sales Order'
            });
            
            // Add HTML field to display information
            var htmlField = form.addField({
                id: 'custpage_info_html',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Order Details'
            });
            
            htmlField.defaultValue = `
                <div style="margin: 20px 0; padding: 15px; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 5px;">
                    <h3>Sales Order Details to be Created:</h3>
                    <ul>
                        <li><strong>Customer ID:</strong> 317</li>
                        <li><strong>Other Reference Number:</strong> JL-Test-0001</li>
                        <li><strong>Supplier Number:</strong> 872165</li>
                        <li><strong>Line Item ID:</strong> 3156 (Quantity: 1)</li>
                    </ul>
                </div>
            `;
            
            // Add submit button
            form.addSubmitButton({
                label: 'Create Sales Order'
            });
            
            // Add cancel button (optional)
            form.addButton({
                id: 'custpage_cancel',
                label: 'Cancel',
                functionName: 'history.back()'
            });
            
            // Write the form to the response
            context.response.writePage(form);
            
        } catch (e) {
            log.error('Error in showForm', e.toString());
            context.response.write('Error loading form: ' + e.toString());
        }
    }
    
    function createSalesOrder(context) {
        try {
            // Create the sales order record
            var salesOrder = record.create({
                type: record.Type.SALES_ORDER,
                isDynamic: true
            });
            
            // Set header fields
            salesOrder.setValue({
                fieldId: 'entity',
                value: 317 // Customer ID
            });
            
            salesOrder.setValue({
                fieldId: 'otherrefnum',
                value: 'JL-Test-0001'
            });
            
            salesOrder.setValue({
                fieldId: 'custbody_supplier_number_so',
                value: '872165'
            });

            salesOrder.setValue({
                fieldId: 'shipmethod',
                value: 10443
            });

            salesOrder.setValue({
                fieldId: 'custbody_lb_headerdata',
                value: '{"packSlipFields":{"OrderedBy":{"CompanyName":"Paul Hayes","AddressCode":"8119","ContactType":0,"ExtendedAttributes":[{"Name":"N101","Value":"SO"},{"Name":"N103 - Order By Address Code Qualifier","Value":"93"}]},"ShipTo":{"CompanyName":"Paul Hayes","Address1":"C/O THD Ship to Store #1109","Address2":"285 Forum Drive","City":"Columbia","State":"SC","Country":"US","Zip":"29229","AddressCode":"1109","Phone":"8034199336","ContactType":0,"ExtendedAttributes":[{"Name":"N101","Value":"ST"},{"Name":"N103 - Ship To Address Code Qualifier","Value":"93"},{"Name":"PER - Ship To Address Contact Qualifier","Value":"RS"},{"Name":"PER09_RS","Value":"2"}]},"CustomerOrderNumber":"WG90365326","PurchaseOrderNumber":"09565626","Date":"2025-05-29T00:00:00","ShipVia":"AACT","Warehouse":"CA Ontario","Message":""},"shippingLabelFields":{"orderType":"BOSS","marketId":null,"lastMile":null,"lineHaul":"AACT","customerTracking":null,"serviceLevel":"AACT","markForAddress":{"ContactType":0}}}'
            });
            
            // Add line item
            salesOrder.selectNewLine({
                sublistId: 'item'
            });
            
            salesOrder.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                value: 3156 // Item ID
            });
            
            salesOrder.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                value: 1
            });
            
            salesOrder.commitLine({
                sublistId: 'item'
            });
            
            // Save the sales order
            var salesOrderId = salesOrder.save();
            
            log.audit('Sales Order Created', 'Sales Order ID: ' + salesOrderId);
            
            // Create success page
            var form = serverWidget.createForm({
                title: 'Sales Order Created Successfully'
            });
            
            var successHtml = form.addField({
                id: 'custpage_success_html',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Success'
            });
            
            successHtml.defaultValue = `
                <div style="margin: 20px 0; padding: 15px; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 5px; color: #155724;">
                    <h3>✓ Sales Order Created Successfully!</h3>
                    <p><strong>Sales Order ID:</strong> ${salesOrderId}</p>
                    <p><strong>Customer ID:</strong> 317</p>
                    <p><strong>Other Reference Number:</strong> JL-Test-0001</p>
                    <p><strong>Supplier Number:</strong> 872165</p>
                    <p><strong>Line Item:</strong> Item ID 3156 (Quantity: 1)</p>
                </div>
                <div style="margin-top: 20px;">
                    <button onclick="history.back()" style="padding: 8px 16px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Create Another Order</button>
                    <button onclick="window.close()" style="padding: 8px 16px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 10px;">Close</button>
                </div>
            `;
            
            context.response.writePage(form);
            
        } catch (e) {
            log.error('Error creating sales order', e.toString());
            
            // Create error page
            var form = serverWidget.createForm({
                title: 'Error Creating Sales Order'
            });
            
            var errorHtml = form.addField({
                id: 'custpage_error_html',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Error'
            });
            
            errorHtml.defaultValue = `
                <div style="margin: 20px 0; padding: 15px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 5px; color: #721c24;">
                    <h3>✗ Error Creating Sales Order</h3>
                    <p><strong>Error:</strong> ${e.toString()}</p>
                    <p>Please check the following:</p>
                    <ul>
                        <li>Customer ID 317 exists and is active</li>
                        <li>Item ID 3156 exists and is active</li>
                        <li>Custom field 'custbody_supplier_number_so' exists</li>
                        <li>You have permission to create sales orders</li>
                    </ul>
                </div>
                <div style="margin-top: 20px;">
                    <button onclick="history.back()" style="padding: 8px 16px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Try Again</button>
                </div>
            `;
            
            context.response.writePage(form);
        }
    }
    
    return {
        onRequest: onRequest
    };
});
