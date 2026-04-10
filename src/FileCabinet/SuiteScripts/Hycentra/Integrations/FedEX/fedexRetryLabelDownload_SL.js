/**
 * fedexRetryLabelDownload_SL.js
 * Suitelet for retrying FedEx label downloads from client script
 * Called when user clicks "Retry Label Download" button on Item Fulfillment
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/log', './fedexHelper'],
    function (log, fedexHelper) {

        /**
         * Suitelet entry point - handles GET requests from client script
         *
         * @param {Object} context - Script context
         */
        function onRequest(context) {
            var response = {
                success: false,
                message: ''
            };

            try {
                var fulfillmentId = context.request.parameters.ifid;

                if (!fulfillmentId) {
                    response.message = 'Missing Item Fulfillment ID parameter (ifid)';
                    sendResponse(context, response);
                    return;
                }

                log.audit('FedEx Retry Label Download', 'Starting retry for Item Fulfillment: ' + fulfillmentId);

                // Call the fedexHelper retry function
                var result = fedexHelper.retryLabelDownload(fulfillmentId);

                response.success = result.success;
                response.message = result.message || (result.success ? 'Label download successful' : 'Unknown error retrying label download');
                response.downloadedCount = result.downloadedCount || 0;
                response.failedCount = result.failedCount || 0;
                response.remainingCount = result.remainingCount || 0;
                response.totalCount = result.totalCount || 0;

                if (result.success) {
                    log.audit('FedEx Retry Label Download', 'SUCCESS - ' + response.message);
                } else {
                    log.error('FedEx Retry Label Download', 'PARTIAL/FAILED - ' + response.message);
                }

            } catch (e) {
                log.error('FedEx Retry Label Download Error', e.message + '\nStack: ' + e.stack);
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
