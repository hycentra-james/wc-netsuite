/**
 * DepositRemittanceFilter_CS.js
 * Client Script for the Deposit Remittance Number filter.
 * - On page load, injects a "Remittance #" column into the payments sublist
 * - On field change, searches and auto-selects matching payments
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/currentRecord', 'N/search', 'N/ui/dialog'],
    (currentRecord, search, dialog) => {

        const pageInit = () => {
            injectRemittanceColumn();
        };

        /**
         * Triggers selection when the remittance number field changes.
         */
        const fieldChanged = (context) => {
            if (context.fieldId === 'custpage_remittance_filter') {
                selectByRemittance();
            }
        };

        /**
         * Injects a "Remittance #" column into the payments sublist by:
         * 1. Reading all payment IDs from the sublist
         * 2. Searching for their remittance numbers
         * 3. Adding a column header and cell values via DOM
         */
        function injectRemittanceColumn() {
            try {
                const rec = currentRecord.get();
                const sublistId = 'payment';
                const lineCount = rec.getLineCount({ sublistId });

                if (lineCount <= 0) return;

                // Collect all payment IDs from the sublist
                const paymentIds = [];
                for (let i = 0; i < lineCount; i++) {
                    const lineId = rec.getSublistValue({ sublistId, fieldId: 'id', line: i });
                    if (lineId) paymentIds.push(String(lineId));
                }

                if (paymentIds.length === 0) return;

                // Search for remittance numbers for these payments
                const remittanceMap = {};
                const paymentSearch = search.create({
                    type: search.Type.CUSTOMER_PAYMENT,
                    filters: [
                        ['internalid', search.Operator.ANYOF, paymentIds],
                        'AND',
                        ['mainline', search.Operator.IS, 'T']
                    ],
                    columns: ['internalid', 'custbody_fmt_remittence_number']
                });

                paymentSearch.run().each((result) => {
                    const id = String(result.getValue('internalid'));
                    const remNum = result.getValue('custbody_fmt_remittence_number') || '';
                    remittanceMap[id] = remNum;
                    return true;
                });

                // Find the payments sublist table and the MEMO column index
                const table = document.getElementById('payment_splits');
                if (!table) return;

                const headerRow = table.querySelector('tr.uir-machine-headerrow');
                if (!headerRow) return;

                const headers = headerRow.querySelectorAll('td');
                let memoIndex = -1;
                for (let h = 0; h < headers.length; h++) {
                    const text = (headers[h].textContent || '').trim().toUpperCase();
                    if (text === 'MEMO') {
                        memoIndex = h;
                        break;
                    }
                }

                if (memoIndex === -1) return;

                // Insert header cell after MEMO
                const newHeader = document.createElement('td');
                newHeader.className = headers[memoIndex].className;
                newHeader.textContent = 'Remittance #';
                newHeader.style.fontWeight = 'bold';
                headers[memoIndex].after(newHeader);

                // Insert data cells for each row
                const dataRows = table.querySelectorAll('tr[id^="paymentrow"]');
                for (let r = 0; r < dataRows.length; r++) {
                    const cells = dataRows[r].querySelectorAll('td');
                    if (memoIndex >= cells.length) continue;

                    const paymentId = paymentIds[r] || '';
                    const remNum = remittanceMap[paymentId] || '';

                    const newCell = document.createElement('td');
                    newCell.className = cells[memoIndex].className;
                    newCell.textContent = remNum;
                    cells[memoIndex].after(newCell);
                }

            } catch (e) {
                console.error('injectRemittanceColumn error:', e);
            }
        }

        /**
         * Searches for Customer Payments matching the remittance number
         * and checks the corresponding lines in the Deposit payments sublist.
         */
        const selectByRemittance = () => {
            const rec = currentRecord.get();
            const remittanceNum = rec.getValue({ fieldId: 'custpage_remittance_filter' });

            if (!remittanceNum) {
                return;
            }

            // Search for Customer Payments with this remittance number
            const paymentIds = [];
            try {
                const paymentSearch = search.create({
                    type: search.Type.CUSTOMER_PAYMENT,
                    filters: [
                        ['custbody_fmt_remittence_number', search.Operator.IS, remittanceNum],
                        'AND',
                        ['mainline', search.Operator.IS, 'T']
                    ],
                    columns: ['internalid']
                });

                paymentSearch.run().each((result) => {
                    paymentIds.push(String(result.getValue('internalid')));
                    return true;
                });
            } catch (e) {
                dialog.alert({ title: 'Search Error', message: 'Error searching payments: ' + e.message });
                return;
            }

            if (paymentIds.length === 0) {
                dialog.alert({
                    title: 'No Payments Found',
                    message: 'No Customer Payments found with Remittance Number: ' + remittanceNum
                });
                return;
            }

            // Iterate the Deposit payments sublist and check matching lines
            const sublistId = 'payment';
            const lineCount = rec.getLineCount({ sublistId });
            let matchCount = 0;

            for (let i = 0; i < lineCount; i++) {
                const lineId = String(rec.getSublistValue({
                    sublistId,
                    fieldId: 'id',
                    line: i
                }));

                if (paymentIds.includes(lineId)) {
                    rec.selectLine({ sublistId, line: i });
                    rec.setCurrentSublistValue({ sublistId, fieldId: 'deposit', value: true });
                    rec.commitLine({ sublistId });
                    matchCount++;
                }
            }

            if (matchCount === 0) {
                dialog.alert({
                    title: 'No Matches on Deposit',
                    message: 'Found ' + paymentIds.length + ' payment(s) with this remittance number, but none appear in the Deposit payments list. They may already be deposited.'
                });
            } else {
                dialog.alert({
                    title: 'Selection Complete',
                    message: 'Selected ' + matchCount + ' of ' + paymentIds.length + ' payment(s) for Remittance Number: ' + remittanceNum
                });
            }
        };

        /**
         * Unchecks all lines in the Deposit payments sublist.
         */
        const clearSelection = () => {
            const rec = currentRecord.get();
            const sublistId = 'payment';
            const lineCount = rec.getLineCount({ sublistId });

            for (let i = 0; i < lineCount; i++) {
                const isChecked = rec.getSublistValue({ sublistId, fieldId: 'deposit', line: i });
                if (isChecked) {
                    rec.selectLine({ sublistId, line: i });
                    rec.setCurrentSublistValue({ sublistId, fieldId: 'deposit', value: false });
                    rec.commitLine({ sublistId });
                }
            }
        };

        return {
            pageInit,
            fieldChanged,
            selectByRemittance,
            clearSelection
        };
    });
