/**
 * fedexRefreshToken_SL.js
 * Suitelet to manually refresh FedEx OAuth access token
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget', 'N/record', 'N/runtime', 'N/log', 'N/https', 'N/error'],
    function(serverWidget, record, runtime, log, https, error) {

        const CONFIG_RECORD_TYPE = 'customrecord_hyc_fedex_config';
        const SANDBOX_CONFIG_RECORD_ID = 1;
        const PRODUCTION_CONFIG_RECORD_ID = 2;

        /**
         * Main entry point for the Suitelet
         */
        function onRequest(context) {
            if (context.request.method === 'GET') {
                displayForm(context);
            } else {
                processRefresh(context);
            }
        }

        /**
         * Display the token refresh form
         */
        function displayForm(context) {
            try {
                var form = serverWidget.createForm({
                    title: 'FedEx OAuth Token Manager'
                });

                // Determine environment
                var isSandbox = (runtime.envType === runtime.EnvType.SANDBOX);
                var configRecordId = isSandbox ? SANDBOX_CONFIG_RECORD_ID : PRODUCTION_CONFIG_RECORD_ID;
                var environment = isSandbox ? 'SANDBOX' : 'PRODUCTION';

                // Add environment info
                form.addFieldGroup({
                    id: 'custpage_env_group',
                    label: 'Environment Information'
                });

                var envField = form.addField({
                    id: 'custpage_environment',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Current Environment',
                    container: 'custpage_env_group'
                });
                envField.updateDisplayType({
                    displayType: serverWidget.FieldDisplayType.INLINE
                });
                envField.defaultValue = environment + ' (Config Record ID: ' + configRecordId + ')';

                // Load current token info
                var tokenInfo = getCurrentTokenInfo(configRecordId);

                // Add current token status
                form.addFieldGroup({
                    id: 'custpage_status_group',
                    label: 'Current Token Status'
                });

                var statusHtml = buildStatusHtml(tokenInfo);
                var statusField = form.addField({
                    id: 'custpage_status',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Status',
                    container: 'custpage_status_group'
                });
                statusField.defaultValue = statusHtml;

                // Add refresh button
                form.addSubmitButton({
                    label: 'Refresh Token Now'
                });

                // Add instructions
                form.addFieldGroup({
                    id: 'custpage_instructions_group',
                    label: 'Instructions'
                });

                var instructionsField = form.addField({
                    id: 'custpage_instructions',
                    type: serverWidget.FieldType.LONGTEXT,
                    label: 'How to Use',
                    container: 'custpage_instructions_group'
                });
                instructionsField.updateDisplayType({
                    displayType: serverWidget.FieldDisplayType.INLINE
                });
                instructionsField.defaultValue =
                    'This tool allows you to manually refresh the FedEx OAuth access token.\n\n' +
                    'Click "Refresh Token Now" to:\n' +
                    '1. Call the FedEx OAuth API with your stored Client ID and Secret\n' +
                    '2. Retrieve a new access token\n' +
                    '3. Update the configuration record with the new token and expiration\n\n' +
                    'The token will automatically refresh during normal operations if:\n' +
                    '- The token is missing\n' +
                    '- The token has expired\n' +
                    '- An API call returns an authentication error\n\n' +
                    'Use this tool if you need to force a token refresh for testing or troubleshooting.';

                context.response.writePage(form);

            } catch (e) {
                log.error({
                    title: 'Error displaying token refresh form',
                    details: e.message + '\nStack: ' + e.stack
                });
                context.response.write('Error: ' + e.message);
            }
        }

        /**
         * Process the token refresh request
         */
        function processRefresh(context) {
            try {
                var isSandbox = (runtime.envType === runtime.EnvType.SANDBOX);
                var configRecordId = isSandbox ? SANDBOX_CONFIG_RECORD_ID : PRODUCTION_CONFIG_RECORD_ID;

                log.audit('FedEx Token Refresh', 'Starting manual token refresh for config record ID: ' + configRecordId);

                // Load the config record
                var tokenRecord = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: configRecordId
                });

                // Call the refresh function from fedexHelper
                var result = refreshTokenDirect(tokenRecord);

                // Display success form
                displayResultForm(context, true, result);

            } catch (e) {
                log.error({
                    title: 'Error refreshing token',
                    details: e.message + '\nStack: ' + e.stack
                });

                // Display error form
                displayResultForm(context, false, {
                    error: e.message,
                    stack: e.stack
                });
            }
        }

        /**
         * Refresh the token directly (copied from fedexHelper to avoid circular dependencies)
         */
        function refreshTokenDirect(tokenRecord) {
            var baseUrl = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_endpoint' }) || "https://apis.fedex.com/";

            // Ensure endpoint ends with trailing slash
            if (!baseUrl.endsWith('/')) {
                baseUrl = baseUrl + '/';
            }

            var apiUrl = baseUrl + "oauth/token";
            var clientId = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_client_id' });
            var clientSecret = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_secret' });
            var grantType = 'client_credentials';

            // Validate credentials
            if (!clientId || !clientSecret) {
                throw new Error('Client ID or Client Secret is missing in the configuration record');
            }

            // Set up the request payload
            var payload = 'grant_type=' + grantType + '&client_id=' + clientId + '&client_secret=' + clientSecret;

            log.audit('Token Refresh', 'Calling FedEx OAuth API at: ' + apiUrl);

            var response = https.post({
                url: apiUrl,
                body: payload,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            if (response.code === 200) {
                var responseBody = JSON.parse(response.body);
                var accessToken = responseBody.access_token;
                var expiresIn = responseBody.expires_in;

                log.audit('Token Refresh', 'Successfully obtained new token (expires in ' + expiresIn + ' seconds)');

                // Update the access token in the record
                var bufferSeconds = 300; // 5 minutes buffer
                var expirationTimestamp = new Date().getTime() + ((expiresIn - bufferSeconds) * 1000);

                var isSandbox = (runtime.envType === runtime.EnvType.SANDBOX);
                var configRecordId = isSandbox ? SANDBOX_CONFIG_RECORD_ID : PRODUCTION_CONFIG_RECORD_ID;

                record.submitFields({
                    type: CONFIG_RECORD_TYPE,
                    id: configRecordId,
                    values: {
                        'custrecord_hyc_fedex_access_token': accessToken,
                        'custrecord_hyc_fedex_expiration': new Date(expirationTimestamp)
                    }
                });

                log.audit('Token Refresh', 'Token updated successfully in config record ID: ' + configRecordId);

                return {
                    success: true,
                    accessToken: accessToken.substring(0, 20) + '...',
                    expiresIn: expiresIn,
                    expirationDate: new Date(expirationTimestamp).toISOString()
                };
            } else {
                throw new Error('FedEx OAuth API returned status ' + response.code + ': ' + response.body);
            }
        }

        /**
         * Get current token information
         */
        function getCurrentTokenInfo(configRecordId) {
            try {
                var tokenRecord = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: configRecordId
                });

                var accessToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_access_token' });
                var expiration = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_expiration' });
                var clientId = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_client_id' });
                var secret = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_secret' });
                var endpoint = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_endpoint' });
                var accountNumber = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_account_number' });

                var now = new Date();
                var isExpired = expiration ? (new Date(expiration) < now) : true;

                return {
                    hasToken: !!accessToken,
                    tokenPreview: accessToken ? accessToken.substring(0, 20) + '...' : 'NOT SET',
                    expiration: expiration || 'NOT SET',
                    isExpired: isExpired,
                    hasClientId: !!clientId,
                    clientIdPreview: clientId ? clientId.substring(0, 10) + '...' : 'NOT SET',
                    hasSecret: !!secret,
                    endpoint: endpoint || 'NOT SET',
                    accountNumber: accountNumber || 'NOT SET'
                };
            } catch (e) {
                log.error('Error loading token info', e.message);
                return {
                    error: e.message
                };
            }
        }

        /**
         * Build HTML for token status display
         */
        function buildStatusHtml(tokenInfo) {
            if (tokenInfo.error) {
                return '<div style="color: red; padding: 10px; border: 1px solid red; background: #ffe6e6;">' +
                       '<strong>Error loading configuration:</strong> ' + tokenInfo.error +
                       '</div>';
            }

            var tokenStatus = tokenInfo.hasToken ?
                (tokenInfo.isExpired ? '<span style="color: orange;">EXPIRED</span>' : '<span style="color: green;">VALID</span>') :
                '<span style="color: red;">NOT SET</span>';

            var html = '<div style="font-family: monospace; padding: 10px; background: #f5f5f5; border: 1px solid #ccc;">';
            html += '<table style="width: 100%; border-collapse: collapse;">';
            html += '<tr><td style="padding: 5px;"><strong>Access Token Status:</strong></td><td style="padding: 5px;">' + tokenStatus + '</td></tr>';
            html += '<tr><td style="padding: 5px;"><strong>Token Preview:</strong></td><td style="padding: 5px;">' + tokenInfo.tokenPreview + '</td></tr>';
            html += '<tr><td style="padding: 5px;"><strong>Expires At:</strong></td><td style="padding: 5px;">' + tokenInfo.expiration + '</td></tr>';
            html += '<tr><td style="padding: 5px;"><strong>Client ID:</strong></td><td style="padding: 5px;">' + (tokenInfo.hasClientId ? tokenInfo.clientIdPreview : '<span style="color: red;">NOT SET</span>') + '</td></tr>';
            html += '<tr><td style="padding: 5px;"><strong>Client Secret:</strong></td><td style="padding: 5px;">' + (tokenInfo.hasSecret ? '***SET***' : '<span style="color: red;">NOT SET</span>') + '</td></tr>';
            html += '<tr><td style="padding: 5px;"><strong>API Endpoint:</strong></td><td style="padding: 5px;">' + tokenInfo.endpoint + '</td></tr>';
            html += '<tr><td style="padding: 5px;"><strong>Account Number:</strong></td><td style="padding: 5px;">' + tokenInfo.accountNumber + '</td></tr>';
            html += '</table>';
            html += '</div>';

            return html;
        }

        /**
         * Display the result form after token refresh
         */
        function displayResultForm(context, success, result) {
            var form = serverWidget.createForm({
                title: 'FedEx Token Refresh Result'
            });

            var resultHtml;
            if (success) {
                resultHtml = '<div style="color: green; padding: 15px; border: 2px solid green; background: #e6ffe6; margin: 10px 0;">' +
                           '<h2 style="margin-top: 0;">✓ Token Refresh Successful!</h2>' +
                           '<table style="font-family: monospace; margin-top: 10px;">' +
                           '<tr><td style="padding: 5px;"><strong>New Token Preview:</strong></td><td style="padding: 5px;">' + result.accessToken + '</td></tr>' +
                           '<tr><td style="padding: 5px;"><strong>Expires In:</strong></td><td style="padding: 5px;">' + result.expiresIn + ' seconds</td></tr>' +
                           '<tr><td style="padding: 5px;"><strong>Expiration Date:</strong></td><td style="padding: 5px;">' + result.expirationDate + '</td></tr>' +
                           '</table>' +
                           '</div>';
            } else {
                resultHtml = '<div style="color: red; padding: 15px; border: 2px solid red; background: #ffe6e6; margin: 10px 0;">' +
                           '<h2 style="margin-top: 0;">✗ Token Refresh Failed</h2>' +
                           '<p><strong>Error:</strong> ' + result.error + '</p>' +
                           '<pre style="background: white; padding: 10px; overflow: auto;">' + (result.stack || '') + '</pre>' +
                           '</div>';
            }

            var resultField = form.addField({
                id: 'custpage_result',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Result'
            });
            resultField.defaultValue = resultHtml;

            // Add back button
            form.addButton({
                id: 'custpage_back',
                label: 'Back to Token Manager',
                functionName: 'window.history.back()'
            });

            context.response.writePage(form);
        }

        return {
            onRequest: onRequest
        };
    }
);
