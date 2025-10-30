/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Resiponsible for
 * 1. Generating SSCC codes for each item in the fulfillment record
 * 2. Automatically Trigger FedEx labels generating when transitioning to Packed (B) status
 * 3. Get field custbody_shipping_label_url from this record and print it if the need to print is checked
 */
define(['N/record','N/log','N/runtime','N/search','N/url','../../Hycentra/ItemFulfillment/SSCC_Helper','../../Hycentra/Integrations/FedEX/fedexHelper','./Con_Lib_Customer_Config','./Con_Lib_Item_Fulfillment_Package'],
    (record, log, runtime, search, url, ssccHelper, fedexHelper, customerCfg, ifPkgLib) => {

        const SSCC_FIELD_ID = 'custcol_fmt_sscc_lpn_number';
        const ALLOWED_SHIP_STATUSES = new Set(['B','C']); // B=Packed, C=Shipped

        function isLTLRecord(shipMethodId) {
            return ifPkgLib.getLtlShipMethodIds().includes(shipMethodId);
        }

        function afterSubmit(ctx){
            try {
                const type = ctx.type;
                if (type !== ctx.UserEventType.CREATE && type !== ctx.UserEventType.EDIT && type !== ctx.UserEventType.XEDIT) return;
                const newRec = ctx.newRecord;
                const shipStatus = newRec.getValue('shipstatus');
                if(!ALLOWED_SHIP_STATUSES.has(shipStatus)) return; // only when Packed or Shipped

                // Determine prior status for transition detection
                let prevShipStatus = null;
                if ((type === ctx.UserEventType.EDIT || type === ctx.UserEventType.XEDIT) && ctx.oldRecord) {
                    try {
                        prevShipStatus = ctx.oldRecord.getValue('shipstatus');
                    } catch(e) {}
                }

                const isTransitionToPacked = (shipStatus === 'B' && prevShipStatus !== 'B');

                // Load full record in dynamic mode to set sublist values
                const ifId = newRec.id;
                if(!ifId) return;

                const fulfillRec = record.load({ type: record.Type.ITEM_FULFILLMENT, id: ifId, isDynamic: false });
                const lineCount = fulfillRec.getLineCount({ sublistId: 'item' });
                let anyUpdated = false;

                // Cache for item field lookups to avoid duplicate searches
                const itemCache = Object.create(null);
                function getItemShipUnits(itemId) {
                    if (itemCache[itemId]) return itemCache[itemId];
                    let palletsPerUnit = 0, boxesPerUnit = 0;
                    try {
                        const lf = search.lookupFields({
                            type: search.Type.ITEM,
                            id: itemId,
                            columns: ['custitem_fmt_pallet_quantity','custitem_fmt_no_boxes']
                        });
                        palletsPerUnit = Number(lf.custitem_fmt_pallet_quantity) || 0;
                        boxesPerUnit = Number(lf.custitem_fmt_no_boxes) || 0;
                    } catch(e) {
                        log.error({ title:'Item Lookup Failed', details: `Item ${itemId}: ${e.message}` });
                    }
                    itemCache[itemId] = { palletsPerUnit, boxesPerUnit };
                    return itemCache[itemId];
                }

                const customerId = fulfillRec.getValue({ fieldId: 'entity' }) || '';

                // Get Sales Order items for comparison
                const salesOrderId = fulfillRec.getValue({ fieldId: 'createdfrom' });
                let salesOrderItems = new Set();

                if (salesOrderId) {
                    try {
                        const salesOrderRec = record.load({ type: record.Type.SALES_ORDER, id: salesOrderId, isDynamic: false });
                        const soLineCount = salesOrderRec.getLineCount({ sublistId: 'item' });

                        log.debug({
                            title: 'SSCC Debug - Sales Order Info',
                            details: `Sales Order ID: ${salesOrderId}, SO Line Count: ${soLineCount}`
                        });

                        for (let j = 0; j < soLineCount; j++) {
                            const soItemId = salesOrderRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: j });
                            if (soItemId) {
                                salesOrderItems.add(soItemId.toString());
                            }
                        }

                        log.debug({
                            title: 'SSCC Debug - Sales Order Items',
                            details: `SO Items: ${Array.from(salesOrderItems).join(', ')}`
                        });

                    } catch (e) {
                        log.error({ title: 'Sales Order Lookup Failed', details: `SO ID ${salesOrderId}: ${e.message}` });
                    }
                }

                for (let i = 0; i < lineCount; i++) {
                    const isSsccGenerated = fulfillRec.getSublistValue({ sublistId: 'item', fieldId: SSCC_FIELD_ID, line: i }) || '';
                    const qty = Number(fulfillRec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
                    const itemId = fulfillRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                    if (!itemId) continue;
                    const { palletsPerUnit, boxesPerUnit } = getItemShipUnits(itemId);

                    const itemText = fulfillRec.getSublistText({ sublistId: 'item', fieldId: 'item', line: i }) || '';

                    // Check if this item exists in the original Sales Order
                    const existsInSO = salesOrderItems.has(itemId.toString());

                    log.debug({
                        title: `SSCC Debug - Line ${i}`,
                        details: `Item: ${itemText} (ID: ${itemId}), Qty: ${qty}, Existing SSCC: ${isSsccGenerated ? 'YES' : 'NO'}, Exists in SO: ${existsInSO ? 'YES' : 'NO'}`
                    });

                    // Skip items that don't exist in the original Sales Order (WMS-added member items)
                    if (!existsInSO) {
                        log.debug({ title: `SSCC Debug - Line ${i} Skipped`, details: 'Item not found in original Sales Order (WMS-added member item)' });
                        continue;
                    }

                    // Determine shipping units using centralized preference
                    let shipUnits = 0;
                    const pref = customerCfg.getShippingUnitPreference(customerId);
                    // if (pref === customerCfg.SHIPPING_UNIT_PREFERENCE.BOXES_FIRST) {
                    //     if (boxesPerUnit > 0) shipUnits = boxesPerUnit * qty;
                    //     else if (palletsPerUnit > 0) shipUnits = palletsPerUnit * qty;
                    //     else shipUnits = qty;
                    // } else { // PALLETS_FIRST
                    //     if (palletsPerUnit > 0) shipUnits = palletsPerUnit * qty;
                    //     else if (boxesPerUnit > 0) shipUnits = boxesPerUnit * qty;
                    //     else shipUnits = qty;
                    // }
                    // Update logic 27/10/2025:
                    // Always generate SSCC count based on Pallets
                    // But the copies still follow the customer preference
                    if (palletsPerUnit > 0) shipUnits = palletsPerUnit * qty;
                    else if (boxesPerUnit > 0) shipUnits = boxesPerUnit * qty;
                    else shipUnits = qty;


                    log.debug({
                        title: `SSCC Debug - Line ${i} Shipping Units`,
                        details: `Item: ${itemText}, Calculated ShipUnits: ${shipUnits}`
                    });

                    if (shipUnits <= 0) continue;
                    // Skip SSCC Generation if it's already generated
                    if (isSsccGenerated) continue;

                    const codes = [];
                    for (let n = 0; n < shipUnits; n++) {
                        log.debug({
                            title: `SSCC Debug - Line ${i} Generation`,
                            details: `Generating SSCC #${n+1} of ${shipUnits} for item ${itemText}`
                        });
                        const code = ssccHelper.generateSSCC();
                        if (!code) {
                            log.error({ title: 'SSCC Generation Failed', details: `Stopped at line ${i} unit index code #${n+1}` });
                            break;
                        }
                        codes.push(code);
                        log.debug({
                            title: `SSCC Debug - Line ${i} Generated`,
                            details: `Generated SSCC: ${code}`
                        });
                    }
                    if (codes.length === shipUnits) {
                        fulfillRec.setSublistValue({ sublistId: 'item', fieldId: SSCC_FIELD_ID, line: i, value: codes.join(',') });
                        anyUpdated = true;
                    } else if (codes.length) {
                        log.error({ title: 'Partial SSCC Generation', details: `Line ${i} expected ${shipUnits} got ${codes.length}` });
                        fulfillRec.setSublistValue({ sublistId: 'item', fieldId: SSCC_FIELD_ID, line: i, value: codes.join(',') });
                        anyUpdated = true;
                    }
                }

                if (anyUpdated) {
                    fulfillRec.save({ enableSourcing: false, ignoreMandatoryFields: true });
                }


            } catch (error) {
                log.error({ title: '' + error.name, details: `Error Message: ${error.message} | Error Stack: ${error.stack}` });
            }
        }

        return { afterSubmit };
    });
