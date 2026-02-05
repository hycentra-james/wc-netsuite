/**
 * ShopifyPaymentImport_CS.js
 * Client Script for Shopify Payment Import Suitelet
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/currentRecord', 'N/url'],
    (currentRecord, url) => {

        /**
         * Page initialization
         */
        const pageInit = () => {
            // Nothing needed on page init
        };

        /**
         * Navigates back to the upload form
         */
        const goBack = () => {
            // Get the current suitelet URL and reload without parameters
            const suiteletUrl = url.resolveScript({
                scriptId: 'customscript_hyc_shopify_payment_import',
                deploymentId: 'customdeploy_hyc_shopify_payment_import'
            });
            window.location.href = suiteletUrl;
        };

        /**
         * Starts a new import (same as goBack)
         */
        const newImport = () => {
            goBack();
        };

        /**
         * Form save validation (before submit)
         */
        const saveRecord = () => {
            const rec = currentRecord.get();
            const action = rec.getValue({ fieldId: 'custpage_action' });

            if (action === 'import') {
                // Confirm before importing
                const validationData = rec.getValue({ fieldId: 'custpage_validation_data' });
                if (validationData) {
                    try {
                        const data = JSON.parse(validationData);
                        if (data.length > 0) {
                            return confirm('Are you sure you want to create ' + data.length + ' Customer Payment(s)?');
                        }
                    } catch (e) {
                        console.error('Error parsing validation data', e);
                    }
                }
            }

            return true;
        };

        return {
            pageInit,
            saveRecord,
            goBack,
            newImport
        };
    });
