/**
 * upsRecreateShipment_SL.js
 * Suitelet for re-creating UPS shipments from client script
 * Called when user clicks "Re-create Shipment" button on Item Fulfillment
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/log', './upsHelper'],
    function (record, log, upsHelper) {

        /**
         * Suitelet entry point - handles both GET requests from client script
         *
         * @param {Object} context - Script context
         */
        function onRequest(context) {
            var response = {
                success: false,
                message: '',
                trackingNumber: ''
            };

            try {
                var fulfillmentId = context.request.parameters.ifid;

                if (!fulfillmentId) {
                    response.message = 'Missing Item Fulfillment ID parameter (ifid)';
                    sendResponse(context, response);
                    return;
                }

                log.audit('UPS Re-create Shipment', 'Starting re-create for Item Fulfillment: ' + fulfillmentId);

                // Load the fulfillment record
                var fulfillmentRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId,
                    isDynamic: false
                });

                var tranId = fulfillmentRecord.getValue({ fieldId: 'tranid' });
                log.debug('UPS Re-create Shipment', 'Loaded fulfillment: ' + tranId);

                // Create the shipment (uses auto-detected IS_TEST_MODE from environment)
                var result = upsHelper.createShipment(fulfillmentRecord);

                if (result.success) {
                    response.success = true;
                    response.message = 'UPS shipment created successfully';
                    response.trackingNumber = result.trackingNumber || '';
                    log.audit('UPS Re-create Shipment', 'SUCCESS - Tracking: ' + response.trackingNumber);
                } else {
                    response.message = result.message || 'Unknown error creating UPS shipment';
                    log.error('UPS Re-create Shipment', 'FAILED - ' + response.message);
                }

            } catch (e) {
                log.error('UPS Re-create Shipment Error', e.message + '\nStack: ' + e.stack);
                response.message = 'Error: ' + e.message;
            }

            sendResponse(context, response);
        }

        /**
         * Send JSON response to client
         *
         * @param {Object} context - Script context
         * @param {Object} responseObj - Response object to send
         */
        function sendResponse(context, responseObj) {
            context.response.setHeader({
                name: 'Content-Type',
                value: 'application/json'
            });
            context.response.write(JSON.stringify(responseObj));
        }

        return {
            onRequest: onRequest
        };
    }
);
