/**
 * ManualNextReceiptSync_SL.js
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @NAmdConfig  ../../FMT Consultants/config.json
 *
 * WC-549 FOLLOW-UP: On-demand, single-record version of the scheduled
 * Map/Reduce script UpdateQuantity_ReceiptDate_SalesOrderDriven.js.
 *
 * That M/R script only recomputes custitem_fmt_next_receipt_date /
 * custitem_fmt_next_receipt_quantity / custitem_fmt_avail_kit_quantity for
 * items touched by a real Sales Order / Item Fulfillment / Item Receipt in
 * the last hour. This Suitelet lets James force a resync of ONE Inventory
 * Item or Kit record right now, without waiting for (or faking) a
 * transaction, using the EXACT SAME calculation logic - both this Suitelet
 * and the M/R script require ./lib/NextReceiptCalc.js and call the same
 * functions, so there is only one place the formulas live.
 *
 * Usage:
 *   - GET with no params: shows a form to enter a record's internal ID.
 *   - GET (or bookmarked URL) with ?itemid=<internal id>: processes that
 *     record immediately and renders the result on the same page.
 *   - POST (form submit): same as above, reading the ID from the form field.
 *
 * Item -> parent kit propagation: if the record is an Inventory Item that
 * is the SOLE member of one or more Kits (the SE72QZ00NJ-000000000 /
 * SEQUOIA-72NJ scenario), those single-member kit(s) are also recomputed
 * and written, using the same reverse component->parent-kit search the
 * M/R script already uses (nextReceiptCalc.findKitsContainingComponents).
 * Multi-member parent kits are intentionally left untouched (out of scope
 * per WC-549 request) and are called out as a note on the result page.
 *
 * All calculation/search logic lives in ./lib/NextReceiptCalc.js. This file
 * only handles: HTTP form/URL param handling, record-type detection,
 * before/after value lookups for the confirmation page, and HTML rendering.
 */
define(['N/ui/serverWidget', 'N/record', 'N/search', 'N/log', './lib/NextReceiptCalc'],
    function (serverWidget, record, search, log, nextReceiptCalc) {

        var FORM_TITLE = 'WC-549: Manual Next-Receipt Sync';

        function onRequest(context) {
            try {
                var request = context.request;
                var recordId = request.parameters.itemid || request.parameters.custpage_record_id;
                recordId = recordId ? String(recordId).trim() : '';

                var resultHtml = '';
                if (recordId) {
                    resultHtml = processRecord(recordId);
                }

                renderForm(context, recordId, resultHtml);

            } catch (e) {
                // Belt-and-suspenders: processRecord() already catches its own
                // errors and returns error HTML instead of throwing, but this
                // outer catch makes sure NOTHING (including a bad request
                // param or a serverWidget error) can produce an unhandled
                // exception / raw NetSuite error page.
                log.error({
                    title: 'Unhandled error in ManualNextReceiptSync_SL',
                    details: (e && e.message) + '\n' + (e && e.stack)
                });
                try {
                    renderForm(context, '', buildErrorHtml('Unexpected error: ' + (e && e.message ? e.message : e)));
                } catch (e2) {
                    context.response.write('Fatal error: ' + (e && e.message ? e.message : e));
                }
            }
        }

        /**
         * Render the entry form. Shows the result HTML above the form when
         * a record was just processed (or an error occurred), otherwise
         * shows brief usage instructions.
         */
        function renderForm(context, recordId, resultHtml) {
            var form = serverWidget.createForm({ title: FORM_TITLE });

            if (resultHtml) {
                var resultField = form.addField({
                    id: 'custpage_result',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Result'
                });
                resultField.defaultValue = resultHtml;
            } else {
                var helpField = form.addField({
                    id: 'custpage_help',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Instructions'
                });
                helpField.defaultValue =
                    '<div style="font-family: Arial, sans-serif;">' +
                    '<p>Enter an Inventory Item or Kit internal ID below and click <strong>Sync Record</strong> ' +
                    'to force-recompute its Next Receipt Date / Next Receipt Quantity (and Available Kit ' +
                    'Quantity, for kits) right now - the same logic the hourly scheduled script uses, just ' +
                    'run on demand for one record.</p>' +
                    '<p>You can also bookmark or link directly to <code>?itemid=&lt;internal id&gt;</code> ' +
                    'to trigger a sync without filling in the form.</p>' +
                    '<p>If the record is an Inventory Item that is the sole component of one or more Kits, ' +
                    'those Kit(s) are recomputed too.</p>' +
                    '</div>';
            }

            var idField = form.addField({
                id: 'custpage_record_id',
                type: serverWidget.FieldType.TEXT,
                label: 'Item or Kit Internal ID'
            });
            idField.defaultValue = recordId || '';

            form.addSubmitButton({ label: 'Sync Record' });

            context.response.writePage(form);
        }

        /**
         * Detect and process a single record. Never throws - all errors are
         * caught and returned as HTML so the page always renders cleanly.
         */
        function processRecord(recordId) {
            try {
                if (!/^\d+$/.test(recordId)) {
                    return buildErrorHtml('"' + recordId + '" is not a valid internal ID (expected a number).');
                }

                var typeInfo = detectItemType(recordId);
                if (!typeInfo) {
                    return buildErrorHtml('No item or kit record found with internal ID ' + escapeHtml(recordId) + '.');
                }

                if (typeInfo.type === 'InvtPart') {
                    return processInventoryItem(recordId, typeInfo);
                } else if (typeInfo.type === 'Kit') {
                    return processKit(recordId, typeInfo);
                } else {
                    return buildErrorHtml(
                        'Record ' + escapeHtml(typeInfo.itemId) + ' (internal ID ' + escapeHtml(recordId) + ') ' +
                        'is type "' + escapeHtml(typeInfo.type) + '", not an Inventory Item or Kit. ' +
                        'This tool only supports Inventory Item (InvtPart) and Kit records.'
                    );
                }
            } catch (e) {
                log.error({
                    title: 'Error processing record ' + recordId,
                    details: (e && e.message) + '\n' + (e && e.stack)
                });
                return buildErrorHtml('Error processing record ' + escapeHtml(recordId) + ': ' + escapeHtml(e && e.message ? e.message : e));
            }
        }

        /**
         * Detect whether a record ID is an Inventory Item, Kit, or something
         * else, using the same technique the M/R script's own getInputData()
         * uses for its item search (search.Type.ITEM, generic across item
         * subtypes, 'type' column returned as a plain string via getValue -
         * same pattern as findSalesOrderItems/findItemFulfillmentItems/etc.
         * in the M/R script). Returns null if no such item exists at all.
         */
        function detectItemType(recordId) {
            var results = search.create({
                type: search.Type.ITEM,
                filters: [['internalid', 'anyof', recordId]],
                columns: ['type', 'itemid', 'displayname']
            }).run().getRange({ start: 0, end: 1 });

            if (!results || results.length === 0) {
                return null;
            }

            var result = results[0];
            return {
                id: recordId,
                type: result.getValue('type'),
                itemId: result.getValue('itemid'),
                displayName: result.getValue('displayname') || result.getValue('itemid')
            };
        }

        /**
         * Inventory Item path: recompute the item's own next-receipt fields
         * using nextReceiptCalc.calculateInventoryItemReceiptFields() - the
         * exact same function the M/R script's map() InvtPart branch calls -
         * then propagate to any single-member parent kit(s).
         */
        function processInventoryItem(recordId, typeInfo) {
            var before = search.lookupFields({
                type: search.Type.INVENTORY_ITEM,
                id: recordId,
                columns: ['itemid', 'custitem_fmt_next_receipt_date', 'custitem_fmt_next_receipt_quantity']
            });

            var fields = nextReceiptCalc.calculateInventoryItemReceiptFields(recordId);
            var newDate = new Date(fields.receiptDate);
            var newQuantity = fields.quantityOnOrder;

            record.submitFields({
                type: record.Type.INVENTORY_ITEM,
                id: recordId,
                values: {
                    'custitem_fmt_next_receipt_date': newDate,
                    'custitem_fmt_next_receipt_quantity': newQuantity
                }
            });

            var itemRows = [{
                label: before.itemid + ' (item, id ' + recordId + ')',
                beforeDate: before.custitem_fmt_next_receipt_date,
                afterDate: newDate.toLocaleDateString(),
                beforeQty: before.custitem_fmt_next_receipt_quantity,
                afterQty: newQuantity
            }];

            // WC-549 propagation: find parent kit(s) via the SAME reverse
            // component->parent-kit search the M/R script uses
            // (nextReceiptCalc.findKitsContainingComponents), then only
            // recompute the ones where this item is the SOLE member - per
            // the requested scope (SE72QZ00NJ-000000000 / SEQUOIA-72NJ case).
            var parentKitIds = nextReceiptCalc.findKitsContainingComponents([recordId]);
            var kitRows = [];
            var notes = [];

            for (var i = 0; i < parentKitIds.length; i++) {
                var kitId = parentKitIds[i];
                var kitMembers = nextReceiptCalc.getKitMemberDetails(kitId);

                if (kitMembers.length === 1) {
                    kitRows.push(syncKitRecord(kitId));
                } else {
                    notes.push(
                        'Kit (internal ID ' + kitId + ') also contains this item but has ' + kitMembers.length +
                        ' inventory-item members, not 1 - left untouched. Automatic propagation only covers ' +
                        'single-member kits. Run this Suitelet directly against that kit ID (?itemid=' + kitId +
                        ') if you want it recomputed too.'
                    );
                }
            }

            return buildResultHtml({
                headline: 'Inventory Item ' + escapeHtml(typeInfo.itemId) + ' (internal ID ' + escapeHtml(recordId) + ') synced.',
                itemRows: itemRows,
                kitRows: kitRows,
                kitSectionTitle: 'Propagated single-member Kit(s)',
                notes: notes
            });
        }

        /**
         * Kit path: recompute the kit's own fields directly.
         */
        function processKit(recordId, typeInfo) {
            var kitRow = syncKitRecord(recordId);

            return buildResultHtml({
                headline: 'Kit ' + escapeHtml(typeInfo.itemId) + ' (internal ID ' + escapeHtml(recordId) + ') synced.',
                itemRows: [],
                kitRows: [kitRow],
                kitSectionTitle: 'Kit',
                notes: []
            });
        }

        /**
         * Shared kit sync routine - looks up before-values, runs
         * nextReceiptCalc.processKitInventoryAndReceipts() (the exact same
         * function the M/R script's map() kit branch calls), resolves the
         * date/quantity fallbacks via the same shared helpers reduce() now
         * uses, writes the fields, and returns a before/after row. Used for
         * both the direct kit path and item->kit propagation, so there is
         * only one place that does "sync a kit record".
         */
        function syncKitRecord(kitId) {
            var before = search.lookupFields({
                type: search.Type.KIT_ITEM,
                id: kitId,
                columns: ['itemid', 'custitem_fmt_next_receipt_date', 'custitem_fmt_next_receipt_quantity', 'custitem_fmt_avail_kit_quantity']
            });

            var kitResult = nextReceiptCalc.processKitInventoryAndReceipts(kitId);
            var dateToSet = nextReceiptCalc.resolveKitReceiptDate(kitResult.nextReceiptDate);
            var newQty = nextReceiptCalc.resolveKitReceiptQuantity(kitResult.nextReceiptQuantity);
            var newAvailQty = kitResult.availableQuantity;

            record.submitFields({
                type: record.Type.KIT_ITEM,
                id: kitId,
                values: {
                    'custitem_fmt_next_receipt_date': dateToSet,
                    'custitem_fmt_next_receipt_quantity': newQty,
                    'custitem_fmt_avail_kit_quantity': newAvailQty
                }
            });

            return {
                label: before.itemid + ' (kit, id ' + kitId + ')',
                beforeDate: before.custitem_fmt_next_receipt_date,
                afterDate: dateToSet.toLocaleDateString(),
                beforeQty: before.custitem_fmt_next_receipt_quantity,
                afterQty: newQty,
                beforeAvailQty: before.custitem_fmt_avail_kit_quantity,
                afterAvailQty: newAvailQty
            };
        }

        // --------------------------------------------------------------
        // Rendering helpers
        // --------------------------------------------------------------

        function buildResultHtml(data) {
            var html = '<div style="font-family: Arial, sans-serif;">';
            html += '<h3 style="color:#2e7d32;">' + escapeHtml(data.headline) + '</h3>';

            if (data.itemRows && data.itemRows.length > 0) {
                html += renderTable('Inventory Item', data.itemRows, false);
            }
            if (data.kitRows && data.kitRows.length > 0) {
                html += renderTable(data.kitSectionTitle || 'Kit', data.kitRows, true);
            }
            if (data.notes && data.notes.length > 0) {
                html += '<p style="color:#b26a00;"><strong>Notes:</strong></p><ul>';
                for (var i = 0; i < data.notes.length; i++) {
                    html += '<li>' + escapeHtml(data.notes[i]) + '</li>';
                }
                html += '</ul>';
            }
            html += '</div>';
            return html;
        }

        function renderTable(title, rows, includeAvailQty) {
            var html = '<h4>' + escapeHtml(title) + '</h4>';
            html += '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">';
            html += '<tr style="background:#f0f0f0;">' +
                '<th>Record</th>' +
                '<th>Next Receipt Date (before)</th>' +
                '<th>Next Receipt Date (after)</th>' +
                '<th>Next Receipt Qty (before)</th>' +
                '<th>Next Receipt Qty (after)</th>';
            if (includeAvailQty) {
                html += '<th>Avail Kit Qty (before)</th><th>Avail Kit Qty (after)</th>';
            }
            html += '</tr>';

            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                html += '<tr>';
                html += '<td>' + escapeHtml(row.label) + '</td>';
                html += '<td>' + escapeHtml(valueOrBlank(row.beforeDate)) + '</td>';
                html += '<td>' + escapeHtml(row.afterDate) + '</td>';
                html += '<td>' + escapeHtml(valueOrBlank(row.beforeQty)) + '</td>';
                html += '<td>' + escapeHtml(String(row.afterQty)) + '</td>';
                if (includeAvailQty) {
                    html += '<td>' + escapeHtml(valueOrBlank(row.beforeAvailQty)) + '</td>';
                    html += '<td>' + escapeHtml(valueOrBlank(row.afterAvailQty)) + '</td>';
                }
                html += '</tr>';
            }
            html += '</table>';
            return html;
        }

        function buildErrorHtml(message) {
            return '<div style="font-family: Arial, sans-serif; color:#c62828;">' +
                '<h3>Error</h3><p>' + escapeHtml(message) + '</p></div>';
        }

        function valueOrBlank(value) {
            return (value === null || value === undefined || value === '') ? '(blank)' : String(value);
        }

        function escapeHtml(str) {
            if (str === null || str === undefined) {
                return '';
            }
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        return {
            onRequest: onRequest
        };
    });
