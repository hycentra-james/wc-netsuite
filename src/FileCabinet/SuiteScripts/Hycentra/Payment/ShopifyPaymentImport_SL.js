/**
 * ShopifyPaymentImport_SL.js
 * Suitelet for importing Shopify payout CSV files and creating Customer Payments
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget', 'N/search', 'N/record', 'N/log', 'N/format'],
    (serverWidget, search, record, log, format) => {

        // CSV Column Indices (0-based)
        const CSV_COLUMNS = {
            TYPE: 1,           // "charge", "refund", etc.
            ORDER: 2,          // WEB-3436
            PAYOUT_DATE: 6,    // Payment date
            PAYOUT_ID: 7,      // Payout ID to store
            AMOUNT: 9,         // Payment amount (gross)
            CHECKOUT: 12       // Checkout ID for duplicate check
        };

        // Skip reason constants
        const SKIP_REASONS = {
            NOT_CHARGE: 'Not a charge (Type: {type})',
            NO_INVOICE: 'No invoice found for order {order}',
            DUPLICATE: 'Already imported (Checkout ID exists)',
            MULTIPLE_INVOICES: 'Multiple invoices found ({count})',
            NO_SALES_ORDER: 'Sales order not found for {order}',
            PARSE_ERROR: 'Could not parse row: {error}'
        };

        /**
         * Main entry point for the Suitelet
         */
        const onRequest = (context) => {
            try {
                if (context.request.method === 'GET') {
                    showUploadForm(context);
                } else if (context.request.method === 'POST') {
                    const action = context.request.parameters.custpage_action;

                    if (action === 'preview') {
                        handlePreview(context);
                    } else if (action === 'import') {
                        handleImport(context);
                    } else {
                        showUploadForm(context, 'Invalid action specified.');
                    }
                }
            } catch (e) {
                log.error('onRequest Error', e);
                showUploadForm(context, 'Unexpected error: ' + e.message);
            }
        };

        /**
         * Shows the initial upload form
         */
        function showUploadForm(context, errorMessage, successMessage) {
            const form = serverWidget.createForm({
                title: 'Shopify Payment Import'
            });

            // Attach client script
            form.clientScriptModulePath = './ShopifyPaymentImport_CS.js';

            // Show error message if any
            if (errorMessage) {
                const errorField = form.addField({
                    id: 'custpage_error',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: ' '
                });
                errorField.defaultValue = createMessageHtml('error', errorMessage);
            }

            // Show success message if any
            if (successMessage) {
                const successField = form.addField({
                    id: 'custpage_success',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: ' '
                });
                successField.defaultValue = createMessageHtml('success', successMessage);
            }

            // Instructions (displayed outside/above the form fields)
            const instructionsField = form.addField({
                id: 'custpage_instructions',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' '
            });
            instructionsField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE });
            instructionsField.defaultValue = `
                <div style="background-color: #e7f3ff; padding: 15px; border: 1px solid #b3d9ff; border-radius: 4px; margin-bottom: 15px;">
                    <h3 style="margin-top: 0;">Instructions</h3>
                    <ol style="margin: 0 0 15px 0;">
                        <li>Export the payout CSV from Shopify Admin</li>
                        <li>Select the CSV file below and click "Preview"</li>
                        <li>Review the preview results before importing</li>
                        <li>Only "charge" type rows will be imported (refunds are skipped)</li>
                    </ol>
                    <p style="margin-bottom: 5px;"><strong>CSV Column Requirements:</strong></p>
                    <ul style="margin: 0;">
                        <li>Column 2 (B): Type - must be "charge"</li>
                        <li>Column 3 (C): Order - e.g., "WEB-3436"</li>
                        <li>Column 7 (G): Payout Date</li>
                        <li>Column 8 (H): Payout ID</li>
                        <li>Column 10 (J): Amount</li>
                        <li>Column 13 (M): Checkout ID</li>
                    </ul>
                </div>
            `;

            // File upload field
            const fileField = form.addField({
                id: 'custpage_csv_file',
                type: serverWidget.FieldType.FILE,
                label: 'Shopify Payout CSV'
            });
            fileField.isMandatory = true;

            // Hidden action field
            const actionField = form.addField({
                id: 'custpage_action',
                type: serverWidget.FieldType.TEXT,
                label: 'Action'
            });
            actionField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
            actionField.defaultValue = 'preview';

            // Custom submit button at bottom using INLINEHTML
            const submitBtnField = form.addField({
                id: 'custpage_submit_btn',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' '
            });
            submitBtnField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW });
            submitBtnField.defaultValue = `
                <div style="margin-top: 15px;">
                    <input type="submit" value="Preview"
                           style="background-color: #607799; color: white; border: none; padding: 8px 20px;
                                  font-size: 14px; cursor: pointer; border-radius: 3px;"
                           onmouseover="this.style.backgroundColor='#4a5d7a'"
                           onmouseout="this.style.backgroundColor='#607799'">
                </div>
            `;

            context.response.writePage(form);
        }

        /**
         * Handles the preview action - parses CSV and validates rows
         */
        function handlePreview(context) {
            try {
                const uploadedFile = context.request.files.custpage_csv_file;

                if (!uploadedFile) {
                    showUploadForm(context, 'Please select a CSV file to upload.');
                    return;
                }

                // Parse the CSV
                const csvContent = uploadedFile.getContents();
                const rows = parseCSV(csvContent);

                log.debug('CSV Parsed', { rowCount: rows.length });

                if (rows.length <= 1) {
                    showUploadForm(context, 'CSV file is empty or contains only headers.');
                    return;
                }

                // Validate each row and categorize
                const results = validateRows(rows);

                log.audit('Preview Results', {
                    ready: results.ready.length,
                    skippedNoInvoice: results.skippedNoInvoice.length,
                    skippedDuplicate: results.skippedDuplicate.length,
                    skippedNotCharge: results.skippedNotCharge.length,
                    errors: results.errors.length
                });

                // Show preview form
                showPreviewForm(context, results, csvContent);

            } catch (e) {
                log.error('handlePreview Error', e);
                showUploadForm(context, 'Error processing CSV: ' + e.message);
            }
        }

        /**
         * Shows the preview results form
         */
        function showPreviewForm(context, results, csvContent) {
            const form = serverWidget.createForm({
                title: 'Shopify Payment Import - Preview'
            });

            // Attach client script
            form.clientScriptModulePath = './ShopifyPaymentImport_CS.js';

            // Summary section
            const summaryField = form.addField({
                id: 'custpage_summary',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' '
            });
            summaryField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE });

            const totalRows = results.ready.length + results.skippedNoInvoice.length +
                             results.skippedDuplicate.length + results.skippedNotCharge.length +
                             results.errors.length;

            summaryField.defaultValue = `
                <div style="background-color: #f8f9fa; padding: 15px; border: 1px solid #dee2e6; border-radius: 4px; margin-bottom: 20px;">
                    <h3 style="margin-top: 0;">Preview Summary</h3>
                    <div style="display: flex; gap: 30px; flex-wrap: wrap;">
                        <div><strong>Total Rows:</strong> ${totalRows}</div>
                        <div style="color: #28a745;"><strong>Ready to Import:</strong> ${results.ready.length}</div>
                        <div style="color: #6c757d;"><strong>Skipped (No Invoice):</strong> ${results.skippedNoInvoice.length}</div>
                        <div style="color: #6c757d;"><strong>Skipped (Duplicate):</strong> ${results.skippedDuplicate.length}</div>
                        <div style="color: #6c757d;"><strong>Skipped (Not Charge):</strong> ${results.skippedNotCharge.length}</div>
                        <div style="color: #dc3545;"><strong>Errors:</strong> ${results.errors.length}</div>
                    </div>
                </div>
            `;

            // Ready to Import sublist
            if (results.ready.length > 0) {
                const readySublist = form.addSublist({
                    id: 'custpage_ready',
                    type: serverWidget.SublistType.LIST,
                    label: 'Ready to Import (' + results.ready.length + ')'
                });
                addPreviewColumns(readySublist);
                populatePreviewSublist(readySublist, results.ready);
            }

            // Skipped - No Invoice sublist
            if (results.skippedNoInvoice.length > 0) {
                const noInvoiceSublist = form.addSublist({
                    id: 'custpage_no_invoice',
                    type: serverWidget.SublistType.LIST,
                    label: 'Skipped - No Invoice Found (' + results.skippedNoInvoice.length + ')'
                });
                addPreviewColumns(noInvoiceSublist, true);
                populatePreviewSublist(noInvoiceSublist, results.skippedNoInvoice, true);
            }

            // Skipped - Duplicate sublist
            if (results.skippedDuplicate.length > 0) {
                const duplicateSublist = form.addSublist({
                    id: 'custpage_duplicate',
                    type: serverWidget.SublistType.LIST,
                    label: 'Skipped - Duplicate (' + results.skippedDuplicate.length + ')'
                });
                addPreviewColumns(duplicateSublist, true);
                populatePreviewSublist(duplicateSublist, results.skippedDuplicate, true);
            }

            // Skipped - Not Charge sublist
            if (results.skippedNotCharge.length > 0) {
                const notChargeSublist = form.addSublist({
                    id: 'custpage_not_charge',
                    type: serverWidget.SublistType.LIST,
                    label: 'Skipped - Not a Charge (' + results.skippedNotCharge.length + ')'
                });
                addPreviewColumns(notChargeSublist, true);
                populatePreviewSublist(notChargeSublist, results.skippedNotCharge, true);
            }

            // Error sublist
            if (results.errors.length > 0) {
                const errorSublist = form.addSublist({
                    id: 'custpage_errors',
                    type: serverWidget.SublistType.LIST,
                    label: 'Errors (' + results.errors.length + ')'
                });
                addPreviewColumns(errorSublist, true);
                populatePreviewSublist(errorSublist, results.errors, true);
            }

            // Store CSV content and validation results for import
            const csvField = form.addField({
                id: 'custpage_csv_data',
                type: serverWidget.FieldType.LONGTEXT,
                label: 'CSV Data'
            });
            csvField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
            csvField.defaultValue = csvContent;

            const validationField = form.addField({
                id: 'custpage_validation_data',
                type: serverWidget.FieldType.LONGTEXT,
                label: 'Validation Data'
            });
            validationField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
            validationField.defaultValue = JSON.stringify(results.ready);

            // Hidden action field
            const actionField = form.addField({
                id: 'custpage_action',
                type: serverWidget.FieldType.TEXT,
                label: 'Action'
            });
            actionField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
            actionField.defaultValue = 'import';

            // Navigation buttons
            const buttonHtml = form.addField({
                id: 'custpage_buttons',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' '
            });

            const hasValidRows = results.ready.length > 0;
            buttonHtml.defaultValue = `
                <div style="margin-top: 20px;">
                    ${hasValidRows ? '' : '<p style="color: #dc3545;"><strong>No valid rows to import.</strong></p>'}
                </div>
            `;

            if (hasValidRows) {
                form.addSubmitButton({ label: 'Import Payments' });
            }

            form.addButton({
                id: 'custpage_back',
                label: 'Back to Upload',
                functionName: 'goBack'
            });

            context.response.writePage(form);
        }

        /**
         * Adds columns to a preview sublist
         */
        function addPreviewColumns(sublist, includeReason = false) {
            sublist.addField({ id: 'custpage_row', type: serverWidget.FieldType.INTEGER, label: 'Row' });
            sublist.addField({ id: 'custpage_order', type: serverWidget.FieldType.TEXT, label: 'Order' });

            // Sales Order link - URL field with linkText for display
            const soField = sublist.addField({ id: 'custpage_so_link', type: serverWidget.FieldType.URL, label: 'Sales Order' });
            soField.linkText = 'View';

            sublist.addField({ id: 'custpage_type', type: serverWidget.FieldType.TEXT, label: 'Type' });
            sublist.addField({ id: 'custpage_amount', type: serverWidget.FieldType.CURRENCY, label: 'Amount' });
            sublist.addField({ id: 'custpage_payout_date', type: serverWidget.FieldType.TEXT, label: 'Payout Date' });
            sublist.addField({ id: 'custpage_payout_id', type: serverWidget.FieldType.TEXT, label: 'Payout ID' });
            sublist.addField({ id: 'custpage_checkout_id', type: serverWidget.FieldType.TEXT, label: 'Checkout ID' });

            // Existing Payment link (for duplicates) - URL field with linkText for display
            const payField = sublist.addField({ id: 'custpage_pay_link', type: serverWidget.FieldType.URL, label: 'Payment' });
            payField.linkText = 'View';

            // Invoice link - URL field with linkText for display
            const invField = sublist.addField({ id: 'custpage_inv_link', type: serverWidget.FieldType.URL, label: 'Invoice' });
            invField.linkText = 'View';

            if (includeReason) {
                sublist.addField({ id: 'custpage_reason', type: serverWidget.FieldType.TEXT, label: 'Reason' });
            }
        }

        /**
         * Populates a preview sublist with data
         */
        function populatePreviewSublist(sublist, data, includeReason = false) {
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                sublist.setSublistValue({ id: 'custpage_row', line: i, value: row.rowNum || 0 });
                sublist.setSublistValue({ id: 'custpage_order', line: i, value: row.order || '-' });

                // Sales Order URL - only set if we have the ID
                if (row.salesOrderId) {
                    const soUrl = '/app/accounting/transactions/salesord.nl?id=' + row.salesOrderId;
                    sublist.setSublistValue({ id: 'custpage_so_link', line: i, value: soUrl });
                }

                sublist.setSublistValue({ id: 'custpage_type', line: i, value: row.type || '-' });
                sublist.setSublistValue({ id: 'custpage_amount', line: i, value: row.amount || 0 });
                sublist.setSublistValue({ id: 'custpage_payout_date', line: i, value: row.payoutDate || '-' });
                sublist.setSublistValue({ id: 'custpage_payout_id', line: i, value: row.payoutId || '-' });
                sublist.setSublistValue({ id: 'custpage_checkout_id', line: i, value: row.checkoutId || '-' });

                // Existing Payment URL - only set if we have the ID (for duplicates)
                if (row.existingPaymentId) {
                    const payUrl = '/app/accounting/transactions/custpymt.nl?id=' + row.existingPaymentId;
                    sublist.setSublistValue({ id: 'custpage_pay_link', line: i, value: payUrl });
                }

                // Invoice URL - only set if we have the ID
                if (row.invoiceId) {
                    const invUrl = '/app/accounting/transactions/custinvc.nl?id=' + row.invoiceId;
                    sublist.setSublistValue({ id: 'custpage_inv_link', line: i, value: invUrl });
                }

                if (includeReason) {
                    sublist.setSublistValue({ id: 'custpage_reason', line: i, value: row.skipReason || '-' });
                }
            }
        }

        /**
         * Handles the import action - creates Customer Payments
         */
        function handleImport(context) {
            try {
                const validationDataStr = context.request.parameters.custpage_validation_data;

                if (!validationDataStr) {
                    showUploadForm(context, 'No validation data found. Please start over.');
                    return;
                }

                const validRows = JSON.parse(validationDataStr);

                if (validRows.length === 0) {
                    showUploadForm(context, 'No valid rows to import.');
                    return;
                }

                log.audit('Starting Import', { rowCount: validRows.length });

                // Process each valid row and create payments
                const importResults = {
                    success: [],
                    failed: []
                };

                for (const row of validRows) {
                    try {
                        const paymentResult = createCustomerPayment(row);
                        importResults.success.push({
                            ...row,
                            paymentId: paymentResult.paymentId,
                            paymentTranId: paymentResult.paymentTranId
                        });
                    } catch (e) {
                        log.error('Payment Creation Failed', { row: row, error: e.message });
                        importResults.failed.push({
                            ...row,
                            error: e.message
                        });
                    }
                }

                log.audit('Import Complete', {
                    success: importResults.success.length,
                    failed: importResults.failed.length
                });

                // Show results
                showImportResultsForm(context, importResults);

            } catch (e) {
                log.error('handleImport Error', e);
                showUploadForm(context, 'Error during import: ' + e.message);
            }
        }

        /**
         * Shows the import results form
         */
        function showImportResultsForm(context, results) {
            const form = serverWidget.createForm({
                title: 'Shopify Payment Import - Results'
            });

            // Attach client script
            form.clientScriptModulePath = './ShopifyPaymentImport_CS.js';

            // Summary
            const summaryField = form.addField({
                id: 'custpage_summary',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' '
            });
            summaryField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE });

            // Build Quick Links HTML for success results
            let successLinksHtml = '';
            if (results.success.length > 0) {
                successLinksHtml = '<div style="margin-top: 15px;"><h4 style="margin-bottom: 10px;">Quick Links - Created Records</h4><table style="border-collapse: collapse; width: 100%;">';
                successLinksHtml += '<tr style="background-color: #d4edda;"><th style="padding: 8px; text-align: left; border: 1px solid #c3e6cb;">Order</th><th style="padding: 8px; text-align: left; border: 1px solid #c3e6cb;">Sales Order</th><th style="padding: 8px; text-align: left; border: 1px solid #c3e6cb;">Invoice</th><th style="padding: 8px; text-align: left; border: 1px solid #c3e6cb;">Payment</th><th style="padding: 8px; text-align: left; border: 1px solid #c3e6cb;">Amount</th></tr>';

                for (const row of results.success) {
                    const soUrl = '/app/accounting/transactions/salesord.nl?id=' + row.salesOrderId;
                    const invUrl = '/app/accounting/transactions/custinvc.nl?id=' + row.invoiceId;
                    const payUrl = '/app/accounting/transactions/custpymt.nl?id=' + row.paymentId;

                    successLinksHtml += '<tr>';
                    successLinksHtml += '<td style="padding: 8px; border: 1px solid #ddd;">' + row.order + '</td>';
                    successLinksHtml += '<td style="padding: 8px; border: 1px solid #ddd;"><a href="' + soUrl + '" target="_blank">' + row.salesOrderTranId + '</a></td>';
                    successLinksHtml += '<td style="padding: 8px; border: 1px solid #ddd;"><a href="' + invUrl + '" target="_blank">' + row.invoiceTranId + '</a></td>';
                    successLinksHtml += '<td style="padding: 8px; border: 1px solid #ddd;"><a href="' + payUrl + '" target="_blank">' + row.paymentTranId + '</a></td>';
                    successLinksHtml += '<td style="padding: 8px; border: 1px solid #ddd;">$' + (row.amount || 0).toFixed(2) + '</td>';
                    successLinksHtml += '</tr>';
                }

                successLinksHtml += '</table></div>';
            }

            const successColor = results.success.length > 0 ? '#28a745' : '#6c757d';
            const failedColor = results.failed.length > 0 ? '#dc3545' : '#6c757d';

            summaryField.defaultValue = `
                <div style="background-color: #d4edda; padding: 15px; border: 1px solid #c3e6cb; border-radius: 4px; margin-bottom: 20px;">
                    <h3 style="margin-top: 0;">Import Complete</h3>
                    <div style="display: flex; gap: 30px;">
                        <div style="color: ${successColor};"><strong>Payments Created:</strong> ${results.success.length}</div>
                        <div style="color: ${failedColor};"><strong>Failed:</strong> ${results.failed.length}</div>
                    </div>
                    ${successLinksHtml}
                </div>
            `;

            // Failed sublist
            if (results.failed.length > 0) {
                const failedSublist = form.addSublist({
                    id: 'custpage_failed',
                    type: serverWidget.SublistType.LIST,
                    label: 'Failed (' + results.failed.length + ')'
                });

                failedSublist.addField({ id: 'custpage_order', type: serverWidget.FieldType.TEXT, label: 'Order' });
                failedSublist.addField({ id: 'custpage_amount', type: serverWidget.FieldType.CURRENCY, label: 'Amount' });
                failedSublist.addField({ id: 'custpage_invoice', type: serverWidget.FieldType.TEXT, label: 'Invoice' });
                failedSublist.addField({ id: 'custpage_error', type: serverWidget.FieldType.TEXT, label: 'Error' });

                for (let i = 0; i < results.failed.length; i++) {
                    const row = results.failed[i];
                    failedSublist.setSublistValue({ id: 'custpage_order', line: i, value: row.order || '-' });
                    failedSublist.setSublistValue({ id: 'custpage_amount', line: i, value: row.amount || 0 });
                    failedSublist.setSublistValue({ id: 'custpage_invoice', line: i, value: row.invoiceTranId || '-' });
                    failedSublist.setSublistValue({ id: 'custpage_error', line: i, value: row.error || '-' });
                }
            }

            // New Import button
            form.addButton({
                id: 'custpage_new_import',
                label: 'New Import',
                functionName: 'newImport'
            });

            context.response.writePage(form);
        }

        /**
         * Creates a Customer Payment record
         */
        function createCustomerPayment(rowData) {
            log.debug('Creating Payment', rowData);

            // Parse the payout date (Shopify format: YYYY-MM-DD)
            // Convert to NetSuite date without timezone shifting
            const payoutDate = parseShopifyDate(rowData.payoutDate);

            // Create the Customer Payment
            const payment = record.create({
                type: record.Type.CUSTOMER_PAYMENT,
                isDynamic: true
            });

            // Set header fields
            payment.setValue({ fieldId: 'customer', value: rowData.customerId });
            payment.setValue({ fieldId: 'trandate', value: payoutDate });
            payment.setValue({ fieldId: 'memo', value: 'PO#' + rowData.order });
            payment.setValue({ fieldId: 'custbody_fmt_remittence_number', value: rowData.payoutId });
            payment.setValue({ fieldId: 'custbody_hyc_shopify_checkout_id', value: rowData.checkoutId });

            // Apply payment to the specific invoice
            const lineCount = payment.getLineCount({ sublistId: 'apply' });
            let invoiceApplied = false;

            for (let i = 0; i < lineCount; i++) {
                const lineInvoiceId = payment.getSublistValue({
                    sublistId: 'apply',
                    fieldId: 'internalid',
                    line: i
                });

                if (String(lineInvoiceId) === String(rowData.invoiceId)) {
                    payment.selectLine({ sublistId: 'apply', line: i });
                    payment.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                    payment.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'amount', value: rowData.amount });
                    payment.commitLine({ sublistId: 'apply' });
                    invoiceApplied = true;
                    log.debug('Invoice Applied', { invoiceId: rowData.invoiceId, line: i });
                    break;
                }
            }

            if (!invoiceApplied) {
                throw new Error('Could not find invoice ' + rowData.invoiceId + ' in payment apply list');
            }

            // Save the payment
            const paymentId = payment.save();

            log.audit('Payment Created', { paymentId: paymentId, invoiceId: rowData.invoiceId });

            // Update the Invoice with the Payout ID
            record.submitFields({
                type: record.Type.INVOICE,
                id: rowData.invoiceId,
                values: {
                    'custbody_fmt_remittence_number': rowData.payoutId
                }
            });

            log.debug('Invoice Updated', { invoiceId: rowData.invoiceId, payoutId: rowData.payoutId });

            // Get the payment transaction ID
            const paymentTranId = search.lookupFields({
                type: record.Type.CUSTOMER_PAYMENT,
                id: paymentId,
                columns: ['tranid']
            }).tranid;

            return {
                paymentId: paymentId,
                paymentTranId: paymentTranId
            };
        }

        /**
         * Validates all CSV rows and categorizes them
         */
        function validateRows(rows) {
            const results = {
                ready: [],
                skippedNoInvoice: [],
                skippedDuplicate: [],
                skippedNotCharge: [],
                errors: []
            };

            // Skip header row (index 0)
            for (let i = 1; i < rows.length; i++) {
                try {
                    const row = rows[i];
                    const rowNum = i + 1; // Human-readable row number

                    // Skip empty rows
                    if (!row || row.length === 0 || (row.length === 1 && !row[0])) {
                        continue;
                    }

                    // Extract values
                    const type = (row[CSV_COLUMNS.TYPE] || '').trim().toLowerCase();
                    const order = (row[CSV_COLUMNS.ORDER] || '').trim();
                    const payoutDate = (row[CSV_COLUMNS.PAYOUT_DATE] || '').trim();
                    const payoutId = (row[CSV_COLUMNS.PAYOUT_ID] || '').trim();
                    const amountStr = (row[CSV_COLUMNS.AMOUNT] || '0').trim();
                    // Remove leading "#" from checkout ID if present
                    const checkoutId = (row[CSV_COLUMNS.CHECKOUT] || '').trim().replace(/^#/, '');

                    // Parse amount (remove $ and commas if present)
                    const amount = parseFloat(amountStr.replace(/[$,]/g, '')) || 0;

                    const rowData = {
                        rowNum,
                        type,
                        order,
                        payoutDate,
                        payoutId,
                        amount,
                        checkoutId
                    };

                    // Check if type is "charge"
                    if (type !== 'charge') {
                        results.skippedNotCharge.push({
                            ...rowData,
                            skipReason: SKIP_REASONS.NOT_CHARGE.replace('{type}', type || 'empty')
                        });
                        continue;
                    }

                    // Skip if no order number
                    if (!order) {
                        results.skippedNoInvoice.push({
                            ...rowData,
                            skipReason: 'No order number in CSV'
                        });
                        continue;
                    }

                    // Find the Sales Order by otherrefnum FIRST (so we have the ID for links)
                    const salesOrderResult = findSalesOrder(order);

                    if (!salesOrderResult) {
                        results.skippedNoInvoice.push({
                            ...rowData,
                            skipReason: SKIP_REASONS.NO_SALES_ORDER.replace('{order}', order)
                        });
                        continue;
                    }

                    // Find the Invoice for the Sales Order (before duplicate check so we have the link)
                    const invoiceResult = findInvoice(salesOrderResult.id);

                    // Check for duplicate by checkout ID (after finding SO and Invoice so we can include links)
                    if (checkoutId) {
                        const existingPayment = findExistingPayment(checkoutId);
                        if (existingPayment) {
                            results.skippedDuplicate.push({
                                ...rowData,
                                salesOrderId: salesOrderResult.id,
                                salesOrderTranId: salesOrderResult.tranid,
                                invoiceId: invoiceResult ? invoiceResult.id : null,
                                invoiceTranId: invoiceResult ? invoiceResult.tranid : null,
                                existingPaymentId: existingPayment.id,
                                existingPaymentTranId: existingPayment.tranid,
                                skipReason: SKIP_REASONS.DUPLICATE
                            });
                            continue;
                        }
                    }

                    if (!invoiceResult) {
                        results.skippedNoInvoice.push({
                            ...rowData,
                            salesOrderId: salesOrderResult.id,
                            salesOrderTranId: salesOrderResult.tranid,
                            skipReason: SKIP_REASONS.NO_INVOICE.replace('{order}', order)
                        });
                        continue;
                    }

                    if (invoiceResult.multipleFound) {
                        results.errors.push({
                            ...rowData,
                            salesOrderId: salesOrderResult.id,
                            skipReason: SKIP_REASONS.MULTIPLE_INVOICES.replace('{count}', invoiceResult.count)
                        });
                        continue;
                    }

                    // Row is valid and ready to import
                    results.ready.push({
                        ...rowData,
                        salesOrderId: salesOrderResult.id,
                        salesOrderTranId: salesOrderResult.tranid,
                        customerId: invoiceResult.customerId,
                        invoiceId: invoiceResult.id,
                        invoiceTranId: invoiceResult.tranid
                    });

                } catch (e) {
                    log.error('Row Validation Error', { row: i, error: e.message });
                    results.errors.push({
                        rowNum: i + 1,
                        skipReason: SKIP_REASONS.PARSE_ERROR.replace('{error}', e.message)
                    });
                }
            }

            return results;
        }

        /**
         * Finds a Sales Order by otherrefnum (WEB-#### format)
         */
        function findSalesOrder(orderNumber) {
            try {
                const salesOrderSearch = search.create({
                    type: search.Type.SALES_ORDER,
                    filters: [
                        ['mainline', search.Operator.IS, 'T'],
                        'AND',
                        ['otherrefnum', search.Operator.EQUALTO, orderNumber]
                    ],
                    columns: ['internalid', 'tranid', 'entity']
                });

                const results = salesOrderSearch.run().getRange({ start: 0, end: 1 });

                if (results.length > 0) {
                    return {
                        id: results[0].getValue('internalid'),
                        tranid: results[0].getValue('tranid'),
                        customerId: results[0].getValue('entity')
                    };
                }

                return null;
            } catch (e) {
                log.error('findSalesOrder Error', { orderNumber, error: e.message });
                return null;
            }
        }

        /**
         * Finds an Invoice created from a Sales Order
         */
        function findInvoice(salesOrderId) {
            try {
                const invoiceSearch = search.create({
                    type: search.Type.INVOICE,
                    filters: [
                        ['createdfrom', search.Operator.ANYOF, salesOrderId],
                        'AND',
                        ['mainline', search.Operator.IS, 'T']
                    ],
                    columns: ['internalid', 'tranid', 'entity', 'amountremaining']
                });

                const results = invoiceSearch.run().getRange({ start: 0, end: 10 });

                if (results.length === 0) {
                    return null;
                }

                if (results.length > 1) {
                    return {
                        multipleFound: true,
                        count: results.length
                    };
                }

                return {
                    id: results[0].getValue('internalid'),
                    tranid: results[0].getValue('tranid'),
                    customerId: results[0].getValue('entity'),
                    amountRemaining: results[0].getValue('amountremaining')
                };
            } catch (e) {
                log.error('findInvoice Error', { salesOrderId, error: e.message });
                return null;
            }
        }

        /**
         * Checks if a payment with this checkout ID already exists
         * Returns payment info if found, null otherwise
         */
        function findExistingPayment(checkoutId) {
            try {
                const paymentSearch = search.create({
                    type: search.Type.CUSTOMER_PAYMENT,
                    filters: [
                        ['custbody_hyc_shopify_checkout_id', search.Operator.IS, checkoutId],
                        'AND',
                        ['mainline', search.Operator.IS, 'T']
                    ],
                    columns: ['internalid', 'tranid']
                });

                const results = paymentSearch.run().getRange({ start: 0, end: 1 });
                if (results.length > 0) {
                    return {
                        id: results[0].getValue('internalid'),
                        tranid: results[0].getValue('tranid')
                    };
                }
                return null;
            } catch (e) {
                log.error('findExistingPayment Error', { checkoutId, error: e.message });
                return null;
            }
        }

        /**
         * Parses CSV content into rows
         * Handles quoted fields with commas
         */
        function parseCSV(csvContent) {
            const rows = [];
            const lines = csvContent.split(/\r?\n/);

            for (const line of lines) {
                if (!line.trim()) continue;

                const row = [];
                let current = '';
                let inQuotes = false;

                for (let i = 0; i < line.length; i++) {
                    const char = line[i];

                    if (char === '"') {
                        if (inQuotes && line[i + 1] === '"') {
                            // Escaped quote
                            current += '"';
                            i++;
                        } else {
                            // Toggle quote state
                            inQuotes = !inQuotes;
                        }
                    } else if (char === ',' && !inQuotes) {
                        row.push(current);
                        current = '';
                    } else {
                        current += char;
                    }
                }

                row.push(current); // Push last field
                rows.push(row);
            }

            return rows;
        }

        /**
         * Parses Shopify date format (YYYY-MM-DD) to NetSuite Date object
         * Avoids timezone shifting by using date components directly
         */
        function parseShopifyDate(dateStr) {
            if (!dateStr) {
                return new Date();
            }

            // Handle various Shopify date formats
            // YYYY-MM-DD or YYYY-MM-DD HH:MM:SS or MM/DD/YYYY
            let year, month, day;

            if (dateStr.includes('-')) {
                // YYYY-MM-DD format
                const parts = dateStr.split(/[\s T]/)[0].split('-');
                year = parseInt(parts[0], 10);
                month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
                day = parseInt(parts[2], 10);
            } else if (dateStr.includes('/')) {
                // M/D/YYYY or MM/DD/YYYY format
                const parts = dateStr.split('/');
                month = parseInt(parts[0], 10) - 1;
                day = parseInt(parts[1], 10);
                year = parseInt(parts[2], 10);
            } else {
                // Fallback - try to parse as-is
                log.debug('parseShopifyDate', 'Unknown format: ' + dateStr);
                return new Date();
            }

            // Create date using components to avoid timezone issues
            // This creates a date at midnight local time
            return new Date(year, month, day);
        }

        /**
         * Creates HTML for a message box
         */
        function createMessageHtml(type, message) {
            const styles = {
                error: { bg: '#f8d7da', color: '#721c24', border: '#f5c6cb' },
                success: { bg: '#d4edda', color: '#155724', border: '#c3e6cb' },
                warning: { bg: '#fff3cd', color: '#856404', border: '#ffeaa7' },
                info: { bg: '#e7f3ff', color: '#004085', border: '#b3d9ff' }
            };

            const style = styles[type] || styles.info;
            const label = type.charAt(0).toUpperCase() + type.slice(1);

            return `
                <div style="background-color: ${style.bg}; color: ${style.color}; padding: 15px; border: 1px solid ${style.border}; border-radius: 4px; margin-bottom: 20px;">
                    <strong>${label}:</strong> ${message}
                </div>
            `;
        }

        return { onRequest };
    });
