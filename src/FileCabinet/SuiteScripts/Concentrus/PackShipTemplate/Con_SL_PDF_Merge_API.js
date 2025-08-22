/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description PDF Merge Suitelet that reads URLs from custom record and provides client-side merging
 */
define(['N/log', 'N/record', 'N/ui/serverWidget', 'N/search', 'N/runtime'],
    (log, record, serverWidget, search, runtime) => {

        const MERGE_PDF_ACTION = {
            PRINT_STARTED: 'printStarted',
            PRINT_FINISHED: 'printFinished',
        };

        /**
         * Defines the Suitelet script trigger point.
         * @param {Object} scriptContext
         * @param {ServerRequest} scriptContext.request - Incoming request
         * @param {ServerResponse} scriptContext.response - Suitelet response
         * @since 2015.2
         */
        const onRequest = (scriptContext) => {
            try {
                if (scriptContext.request.method === 'GET') {
                    const action = scriptContext.request.parameters.action;
                    const mergeRequestId = scriptContext.request.parameters.mergeRequestId;
                    const openInWeb = scriptContext.request.parameters.openInWeb !== 'false'; // Default true

                    if (action === MERGE_PDF_ACTION.PRINT_STARTED) {
                        handlePrintStarted(scriptContext, mergeRequestId, openInWeb);
                    } else if (action === MERGE_PDF_ACTION.PRINT_FINISHED) {
                        handlePrintFinished(scriptContext, mergeRequestId);
                    } else {
                        // Default behavior - start print process
                        if (mergeRequestId) {
                            handlePrintStarted(scriptContext, mergeRequestId, openInWeb);
                        } else {
                            showError(scriptContext, 'Missing mergeRequestId parameter');
                        }
                    }
                }

            } catch (error) {
                log.error('onRequest Error', error);
                showError(scriptContext, 'Internal server error: ' + error.message);
            }
        };

        /**
         * Handles the print started action
         * @param {Object} scriptContext - Script context
         * @param {string} mergeRequestId - ID of the merge request record
         * @param {boolean} openInWeb - Whether to open PDF in web or download it
         */
        function handlePrintStarted(scriptContext, mergeRequestId, openInWeb = true) {
            try {
                if (!mergeRequestId) {
                    showError(scriptContext, 'Missing merge request ID');
                    return;
                }

                // Load the merge request record
                const mergeRequestRec = record.load({
                    type: 'customrecord_con_merge_print_request',
                    id: mergeRequestId
                });

                const urlsField = mergeRequestRec.getValue('custrecord_con_mp_print_rq_urls');

                if (!urlsField) {
                    showError(scriptContext, 'No URLs found in merge request record');
                    return;
                }

                // Parse URLs (assuming they're separated by newlines)
                const urls = urlsField.split('\n').filter(url => url.trim().length > 0);

                if (urls.length === 0) {
                    showError(scriptContext, 'No valid URLs found for merging');
                    return;
                }

                log.debug('Processing merge request', {
                    mergeRequestId: mergeRequestId,
                    urlCount: urls.length,
                    urls: urls
                });

                // Update the record to mark as processing
                record.submitFields({
                    type: 'customrecord_con_merge_print_request',
                    id: mergeRequestId,
                    values: {
                        'custrecord_con_mp_print_rq_status': 'processing'
                    }
                });

                // Create the form with processing UI
                const form = serverWidget.createForm({
                    title: 'Merging PDF Documents'
                });

                // Add hidden fields for client script
                form.addField({
                    id: 'custpage_merge_request_id',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Merge Request ID'
                }).updateDisplayType({
                    displayType: serverWidget.FieldDisplayType.HIDDEN
                }).defaultValue = mergeRequestId;

                form.addField({
                    id: 'custpage_open_in_web',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Open in Web'
                }).updateDisplayType({
                    displayType: serverWidget.FieldDisplayType.HIDDEN
                }).defaultValue = openInWeb ? 'true' : 'false';

                form.addField({
                    id: 'custpage_file_urls',
                    type: serverWidget.FieldType.LONGTEXT,
                    label: 'File URLs'
                }).updateDisplayType({
                    displayType: serverWidget.FieldDisplayType.HIDDEN
                }).defaultValue = JSON.stringify(urls);

                // Add processing HTML
                const htmlField = form.addField({
                    id: 'custpage_processing_html',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Processing'
                });

                htmlField.defaultValue = `
                    <div id="merge-processing-container" style="text-align: center; padding: 20px;">
                        <h2>Processing PDF Merge...</h2>
                        <p>Please don't close this page while processing.</p>
                        <div id="loading-spinner" style="margin: 20px;">
                            <div style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 0 auto;"></div>
                        </div>
                        <style>
                            @keyframes spin {
                                0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); }
                            }
                        </style>
                    </div>
                `;

                // Attach the client script
                form.clientScriptModulePath = './Con_CS_PDF_Merge_Processor.js';

                scriptContext.response.writePage(form);

            } catch (error) {
                log.error('handlePrintStarted Error', error);
                showError(scriptContext, 'Failed to start PDF merge: ' + error.message);
            }
        }

        /**
         * Handles the print finished action
         * @param {Object} scriptContext - Script context
         * @param {string} mergeRequestId - ID of the merge request record
         */
        function handlePrintFinished(scriptContext, mergeRequestId) {
            try {
                if (mergeRequestId) {
                    // Update the record to mark as completed
                    record.submitFields({
                        type: 'customrecord_con_merge_print_request',
                        id: mergeRequestId,
                        values: {
                            'custrecord_con_mp_print_rq_status': 'completed',
                            'custrecord_con_mp_print_rq_completed': new Date()
                        }
                    });
                }

                const form = serverWidget.createForm({
                    title: 'PDF Merge Completed'
                });

                const htmlField = form.addField({
                    id: 'custpage_completion_html',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Completion'
                });

                htmlField.defaultValue = `
                    <div style="text-align: center; padding: 40px;">
                        <h2 style="color: #28a745;">✓ PDF Merge Completed Successfully!</h2>
                        <p>Your merged PDF has been downloaded.</p>
                        <p style="color: #6c757d; margin-top: 30px;">You can safely close this page.</p>
                    </div>
                `;

                scriptContext.response.writePage(form);

            } catch (error) {
                log.error('handlePrintFinished Error', error);
                showError(scriptContext, 'Error finishing merge process: ' + error.message);
            }
        }

        /**
         * Shows an error page
         * @param {Object} scriptContext - Script context
         * @param {string} errorMessage - Error message to display
         */
        function showError(scriptContext, errorMessage) {
            const form = serverWidget.createForm({
                title: 'PDF Merge Error'
            });

            const htmlField = form.addField({
                id: 'custpage_error_html',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Error'
            });

            htmlField.defaultValue = `
                <div style="text-align: center; padding: 40px;">
                    <h2 style="color: #dc3545;">❌ Error</h2>
                    <p style="color: #721c24; background-color: #f8d7da; padding: 15px; border-radius: 5px; display: inline-block;">
                        ${errorMessage}
                    </p>
                    <p style="margin-top: 30px;">
                        <button onclick="window.close()" style="background-color: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">
                            Close Window
                        </button>
                    </p>
                </div>
            `;

            scriptContext.response.writePage(form);
        }

        return { onRequest };
    });
