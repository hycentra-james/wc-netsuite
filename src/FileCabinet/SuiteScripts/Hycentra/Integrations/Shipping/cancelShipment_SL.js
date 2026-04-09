/**
 * cancelShipment_SL.js
 * Suitelet for cancelling/voiding FedEx and UPS shipments
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget', 'N/log', '../FedEX/fedexHelper', '../UPS/upsHelper'],
    (serverWidget, log, fedexHelper, upsHelper) => {

        const CARRIER_FEDEX = 'fedex';
        const CARRIER_UPS = 'ups';

        /**
         * GET - Display the cancel shipment form
         */
        const onRequest = (context) => {
            if (context.request.method === 'GET') {
                showForm(context);
            } else {
                processCancel(context);
            }
        };

        /**
         * Build and display the cancel shipment form
         */
        const showForm = (context) => {
            const form = serverWidget.createForm({ title: 'Cancel Shipment' });

            form.addField({
                id: 'custpage_instructions',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Instructions'
            }).defaultValue = '<div style="margin-bottom:15px;padding:10px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;">' +
                '<p style="margin:0 0 5px 0;"><b>Instructions:</b></p>' +
                '<ul style="margin:0;padding-left:20px;">' +
                '<li>Select the carrier and enter the tracking number to cancel/void the shipment.</li>' +
                '<li>For UPS multi-package shipments, enter the master tracking number and additional package tracking numbers.</li>' +
                '<li>This only cancels the label with the carrier. It does not modify the Item Fulfillment record in NetSuite.</li>' +
                '</ul></div>';

            const carrierField = form.addField({
                id: 'custpage_carrier',
                type: serverWidget.FieldType.SELECT,
                label: 'Carrier'
            });
            carrierField.addSelectOption({ value: '', text: '' });
            carrierField.addSelectOption({ value: CARRIER_FEDEX, text: 'FedEx' });
            carrierField.addSelectOption({ value: CARRIER_UPS, text: 'UPS' });
            carrierField.isMandatory = true;

            const trackingField = form.addField({
                id: 'custpage_tracking_number',
                type: serverWidget.FieldType.TEXT,
                label: 'Tracking Number'
            });
            trackingField.isMandatory = true;

            const additionalField = form.addField({
                id: 'custpage_additional_tracking',
                type: serverWidget.FieldType.TEXT,
                label: 'Additional Tracking Numbers (UPS multi-package, comma-separated)'
            });

            // Client script to show/hide additional tracking field based on carrier
            form.addField({
                id: 'custpage_client_script',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Client Script'
            }).defaultValue = '<script>' +
                'jQuery(document).ready(function(){' +
                '  function toggleAdditional(){' +
                '    var carrier = jQuery("#custpage_carrier").val();' +
                '    var row = jQuery("#custpage_additional_tracking").closest("tr");' +
                '    if(carrier === "' + CARRIER_UPS + '"){row.show();}else{row.hide();}' +
                '  }' +
                '  toggleAdditional();' +
                '  jQuery("#custpage_carrier").on("change", toggleAdditional);' +
                '});' +
                '</script>';

            form.addSubmitButton({ label: 'Cancel Shipment' });

            context.response.writePage(form);
        };

        /**
         * POST - Process the cancellation request
         */
        const processCancel = (context) => {
            const carrier = context.request.parameters.custpage_carrier;
            const trackingNumber = (context.request.parameters.custpage_tracking_number || '').trim();
            const additionalTracking = (context.request.parameters.custpage_additional_tracking || '').trim();

            log.audit('Cancel Shipment', 'Carrier: ' + carrier + ', Tracking: ' + trackingNumber +
                (additionalTracking ? ', Additional: ' + additionalTracking : ''));

            let result;

            if (carrier === CARRIER_FEDEX) {
                result = fedexHelper.cancelShipment(trackingNumber);
            } else if (carrier === CARRIER_UPS) {
                result = upsHelper.cancelShipment(trackingNumber, additionalTracking || null);
            } else {
                result = { success: false, message: 'Invalid carrier selected.', response: null };
            }

            // Build result page
            const form = serverWidget.createForm({ title: 'Cancel Shipment - Result' });

            const statusColor = result.success ? '#4CAF50' : '#f44336';
            const statusText = result.success ? 'SUCCESS' : 'FAILED';

            let html = '<div style="margin-bottom:15px;">' +
                '<h2 style="color:' + statusColor + ';">' + statusText + '</h2>' +
                '<table style="border-collapse:collapse;margin-bottom:15px;">' +
                '<tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Carrier:</td><td>' + carrier.toUpperCase() + '</td></tr>' +
                '<tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Tracking Number:</td><td>' + trackingNumber + '</td></tr>';

            if (additionalTracking) {
                html += '<tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Additional Tracking:</td><td>' + additionalTracking + '</td></tr>';
            }

            html += '<tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Message:</td><td>' + result.message + '</td></tr>' +
                '</table>';

            if (result.response) {
                html += '<details style="margin-top:10px;"><summary style="cursor:pointer;font-weight:bold;">API Response</summary>' +
                    '<pre style="background:#f5f5f5;padding:10px;border:1px solid #ddd;border-radius:4px;overflow-x:auto;max-width:800px;">' +
                    JSON.stringify(result.response, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;') +
                    '</pre></details>';
            }

            html += '</div>';

            form.addField({
                id: 'custpage_result',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Result'
            }).defaultValue = html;

            // Add back button via inline HTML (no submit button needed)
            form.addField({
                id: 'custpage_back_button',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Back'
            }).defaultValue = '<button type="button" onclick="history.back()" ' +
                'style="margin-top:10px;padding:8px 20px;cursor:pointer;">Back</button>';

            context.response.writePage(form);
        };

        return {
            onRequest: onRequest
        };
    }
);
