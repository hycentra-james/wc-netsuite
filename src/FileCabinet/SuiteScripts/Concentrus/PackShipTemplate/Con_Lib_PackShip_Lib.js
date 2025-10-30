/**
 * Shared Pack & Ship totals computation library.
 * Computes per-line and aggregate shipment metrics from a Sales Order.
 * Logic mirrors original buildLineCarrierRows in BOL Suitelet:
 *  - lineBoxes = boxesPerUnit * quantity
 *  - linePalletQty = palletQtyPerUnit * quantity
 *  - lineWeight = weightPerUnit * quantity
 * Totals are sums of those line-level values.
 *
 * @NApiVersion 2.1
 */

define(['N/search','N/record','N/log'], (search, record, log) => {
  const FIELD_IDS = Object.freeze({
    ITEM_BOXES: 'custitem_fmt_no_boxes',
    ITEM_WEIGHT: 'custitem_fmt_shipping_weight',
    ITEM_PALLET_QTY: 'custitem_fmt_pallet_quantity',
    ITEM_LOWES_COMMODITY: 'custitem_fmt_lowes_item_number',
    ITEM_HD_COMMODITY: 'custitem_hyc_hd_product_name',
    ITEM_NMFC: 'custitem_fmt_nmfc_code',
    ITEM_FREIGHT_CLASS: 'custitem_fmt_freight_class'
  });

  const CUSTOMER = Object.freeze({
    THE_HOME_DEPOT_INC: '317',
    THE_HOME_DEPOT_SPECIAL_PRO: '12703',
    LOWES_HOME_CENTERS_LLC: '275',
    LOWES_HOME_CENTERS_LLS: '275' // alias for client script variant
  });

  function lookupItemFieldsCached(itemId, cache) {
    if (cache[itemId]) return cache[itemId];
    try {
      const lf = search.lookupFields({
        type: search.Type.ITEM,
        id: itemId,
        columns: [
          FIELD_IDS.ITEM_BOXES,
          FIELD_IDS.ITEM_WEIGHT,
          FIELD_IDS.ITEM_PALLET_QTY,
          FIELD_IDS.ITEM_LOWES_COMMODITY,
          FIELD_IDS.ITEM_HD_COMMODITY,
          FIELD_IDS.ITEM_NMFC,
          FIELD_IDS.ITEM_FREIGHT_CLASS
        ]
      });
      cache[itemId] = {
        boxesPerUnit: Number(lf[FIELD_IDS.ITEM_BOXES]) || 0,
        weightPerUnit: Number(lf[FIELD_IDS.ITEM_WEIGHT]) || 0,
        palletQtyPerUnit: Number(lf[FIELD_IDS.ITEM_PALLET_QTY]) || 0,
        lowesCommodity: lf[FIELD_IDS.ITEM_LOWES_COMMODITY] || '',
        hdCommodity: lf[FIELD_IDS.ITEM_HD_COMMODITY] || '',
        nmfc: lf[FIELD_IDS.ITEM_NMFC] || '',
        freightClass: lf[FIELD_IDS.ITEM_FREIGHT_CLASS] || ''
      };
    } catch (e) {
      cache[itemId] = {
        boxesPerUnit: 0,
        weightPerUnit: 0,
        palletQtyPerUnit: 0,
        lowesCommodity: '',
        hdCommodity: '',
        nmfc: '',
        freightClass: ''
      };
    }
    return cache[itemId];
  }

  /**
   * Compute per-line shipment metrics and aggregates for a Sales Order.
   * @param {string|number} soId Sales Order internal id
   * @param {string} customerId Customer internal id (to select commodity flavor)
   * @returns {{
   *  lines: Array<{ itemId:string, quantity:number, boxesPerUnit:number, palletQtyPerUnit:number, weightPerUnit:number, lineBoxes:number, linePalletQty:number, lineWeight:number, commodity:string, nmfc:string, freightClass:string }>,
   *  totalBoxes:number, totalPalletQty:number, totalWeight:number
   * }}
   */
  function computeShipmentTotals(soId, customerId) {
    const lines = [];
    if (!soId) return { lines, totalBoxes:0, totalPalletQty:0, totalWeight:0 };

    const cache = Object.create(null);
    let totalBoxes = 0, totalPalletQty = 0, totalWeight = 0;

    const txnSearch = search.create({
      type: search.Type.SALES_ORDER,
      filters: [ ['internalid','anyof', soId], 'AND', ['mainline','is','F'] ,
        "AND",
        ["shipping","is","F"],
        "AND",
        ["cogs","is","F"],
        "AND",
        ["taxline","is","F"]
      ],
      columns: [ 'item', 'quantity' ]
    });

    txnSearch.run().each(res => {
      const itemId = res.getValue('item');
      if (!itemId) return true;
      const quantity = Number(res.getValue('quantity')) || 0;
      const f = lookupItemFieldsCached(itemId, cache);
      const lineBoxes = f.boxesPerUnit * quantity;
      const linePalletQty = f.palletQtyPerUnit * quantity;
      const lineWeight = f.weightPerUnit * quantity;
      totalBoxes += lineBoxes;
      totalPalletQty += linePalletQty;
      totalWeight += lineWeight;
      const commodity = (customerId === CUSTOMER.LOWES_HOME_CENTERS_LLC || customerId === CUSTOMER.LOWES_HOME_CENTERS_LLS) ? f.lowesCommodity : f.hdCommodity;
      lines.push({
        itemId: String(itemId), quantity,
        boxesPerUnit: f.boxesPerUnit,
        palletQtyPerUnit: f.palletQtyPerUnit,
        weightPerUnit: f.weightPerUnit,
        lineBoxes, linePalletQty, lineWeight,
        commodity, nmfc: f.nmfc, freightClass: f.freightClass
      });
      return true;
    });

    return { lines, totalBoxes, totalPalletQty, totalWeight };
  }

  /**
   * Fetch SSCC codes (comma-separated) from the first item fulfillment (latest by internalid) created from the Sales Order.
   * It reads the first line that has a non-empty SSCC field and returns its raw value and parsed list.
   * @param {string|number} salesOrderId
   * @param {string} [ssccFieldId='custcol_fmt_sscc_lpn_number']
   * @returns {{itemFulfillmentId:string|null, ssccRaw:string, ssccList:string[]}}
   */
  function getFirstLineSSCCBySalesOrder(salesOrderId, ssccFieldId='custcol_fmt_sscc_lpn_number') {
    if (!salesOrderId) return { itemFulfillmentId: null, ssccRaw: '', ssccList: [] };
    try {
      // Get latest item fulfillment (mainline)
      const fulfillSearch = search.create({
        type: search.Type.ITEM_FULFILLMENT,
        filters: [ ['createdfrom','anyof', salesOrderId], 'AND', ['mainline','is','T'] ],
        columns: [ search.createColumn({ name:'internalid', sort: search.Sort.DESC }) ]
      });
      const first = fulfillSearch.run().getRange({ start:0, end:1 });
      if (!first || !first.length) return { itemFulfillmentId: null, ssccRaw: '', ssccList: [] };
      const ifId = first[0].getValue('internalid');
      let ssccRaw = '';
      try {
        const ifRec = record.load({ type: record.Type.ITEM_FULFILLMENT, id: ifId, isDynamic:false });
        const lineCount = ifRec.getLineCount({ sublistId: 'item' });
        for (let i=0;i<lineCount;i++) {
          const val = (ifRec.getSublistValue({ sublistId:'item', fieldId: ssccFieldId, line:i }) || '').trim();
            if (val) { ssccRaw = val; break; }
        }
      } catch (e) {
        log.error({ title:'Load IF for SSCC failed', details: e.message });
        return { itemFulfillmentId: ifId, ssccRaw:'', ssccList: [] };
      }
      const ssccList = ssccRaw ? ssccRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
      return { itemFulfillmentId: ifId, ssccRaw, ssccList };
    } catch (err) {
      log.error({ title:'getFirstLineSSCCBySalesOrder error', details: err.message });
      return { itemFulfillmentId: null, ssccRaw: '', ssccList: [] };
    }
  }

  /**
   * Fetch ALL SSCC codes across every line (latest Item Fulfillment for SO).
   * Returns flattened list preserving line order, plus per-line raw strings.
   * @param {string|number} salesOrderId
   * @param {string} [ssccFieldId='custcol_fmt_sscc_lpn_number']
   * @returns {{itemFulfillmentId:string|null, codes:string[], rawByLine:string[]}}
   */
  function getAllSSCCBySalesOrder(salesOrderId, ssccFieldId='custcol_fmt_sscc_lpn_number') {
    if (!salesOrderId) return { itemFulfillmentId: null, codes: [], rawByLine: [] };
    try {
      const fulfillSearch = search.create({
        type: search.Type.ITEM_FULFILLMENT,
        filters: [ ['createdfrom','anyof', salesOrderId], 'AND', ['mainline','is','T'] ],
        columns: [ search.createColumn({ name:'internalid', sort: search.Sort.DESC }) ]
      });
      const first = fulfillSearch.run().getRange({ start:0, end:1 });
      if (!first || !first.length) return { itemFulfillmentId: null, codes: [], rawByLine: [] };
      const ifId = first[0].getValue('internalid');
      const codes = [];
      const rawByLine = [];
      const codesLine = {};
      const itemDict = {};//key = item Id, value = { quantity, boxes, palletQty}
      try {
        const ifRec = record.load({ type: record.Type.ITEM_FULFILLMENT, id: ifId, isDynamic:false });
        const lineCount = ifRec.getLineCount({ sublistId: 'item' });
        for (let i=0;i<lineCount;i++) {
          const raw = (ifRec.getSublistValue({ sublistId:'item', fieldId: ssccFieldId, line:i }) || '').trim();
          const ssccVal = ifRec.getSublistValue({ sublistId:'item', fieldId: ssccFieldId, line:i })
            if(ssccVal) {
                const ssccs = ssccVal.split(',').map(s=>s.trim());
                ssccs.forEach(sscc => {
                    codesLine[sscc] = {}
                    const itemId =  ifRec.getSublistValue({sublistId: 'item', fieldId: 'item', line: i}) || '';
                    let data = itemDict[itemId];
                    if(!data){
                        const searchObj = search.lookupFields({
                            type: 'item',
                            id: itemId,
                            columns: ['custitem_fmt_no_boxes', 'custitem_fmt_pallet_quantity']
                        });
                        data = {
                            itemId:itemId,
                            boxes: Number(searchObj['custitem_fmt_no_boxes']) || 0,
                            palletQty: Number(searchObj['custitem_fmt_pallet_quantity']) || 0,
                            quantity: ifRec.getSublistValue({sublistId: 'item', fieldId: 'quantity', line: i}) || 0
                        }
                        itemDict[itemId] = data;
                    }
                    codesLine[sscc] = data;
                });
            }
          rawByLine.push(raw);
          if (raw) {
            raw.split(',').forEach(part => {
              const c = part.trim();
              if (c) codes.push(c);
            });
          }
        }
      } catch (e) {
        log.error({ title:'Load IF for ALL SSCC failed', details: e.message });
        return { itemFulfillmentId: ifId, codes, rawByLine, codesLine};
      }
      return { itemFulfillmentId: ifId, codes, rawByLine, codesLine};
    } catch (err) {
      log.error({ title:'getAllSSCCBySalesOrder error', details: err.message });
      return { itemFulfillmentId: null, codes: [], rawByLine: [] };
    }
  }

  return { computeShipmentTotals, FIELD_IDS, CUSTOMER, getFirstLineSSCCBySalesOrder, getAllSSCCBySalesOrder };
});
