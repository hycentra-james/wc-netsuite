/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */

define(['N/record','N/search','N/runtime','./Con_Lib_PackShip_Lib'], (record, search, runtime, totalsLib) => {
  // Customer enum (reuse ids from requirement)
  const CUSTOMER = Object.freeze({
    THE_HOME_DEPOT_INC: '317',
    THE_HOME_DEPOT_SPECIAL_PRO: '12703',
    LOWES_HOME_CENTERS_LLC: '275'
  });
  const SHIPPING_METHOD = {
    FEDEX_FREIGHT_PRIORITY_FEDP: '11596'
  }
  const FIELD_IDS = Object.freeze({
    PRO_NUMBER: 'custbody_pro_number',
    HD_CUSTOMER_ORDER_NUM: 'custbody_customer_order_number',
    ITEM_BOXES: 'custitem_fmt_no_boxes',
    ITEM_WEIGHT: 'custitem_fmt_shipping_weight',
    ITEM_PALLET_QTY: 'custitem_fmt_pallet_quantity',
    ITEM_LOWES_COMMODITY: 'custitem_fmt_lowes_item_number',
    ITEM_HD_COMMODITY: 'custitem_hyc_hd_product_name',
    ITEM_NMFC: 'custitem_fmt_nmfc_code',
    ITEM_FREIGHT_CLASS: 'custitem_fmt_freight_class',
    SCAC: 'custbody_con_scac'
  });
  const ADDRESS_TYPE = {
    RESIDENTIAL: '1',
    COMMERCIAL: '2',
  }

  function getThirdPartyFreightChargesBillTo(customerId) {
    switch (customerId) {
        case CUSTOMER.THE_HOME_DEPOT_INC:
          return 'HomeDepot.Com #8119 <br/>' +
              'Attn: Freight Payables<br/>' +
              '2455 Paces Ferry Road NW<br/>' +
              'Atlanta, GA 30339';
        case CUSTOMER.THE_HOME_DEPOT_SPECIAL_PRO:
            return 'HomeDepot.Com #8119 <br/>' +
                'Attn: Freight Payables<br/>' +
                '2455 Paces Ferry Road NW<br/>' +
                'Atlanta, GA 30339';
        case CUSTOMER.LOWES_HOME_CENTERS_LLC:
            return 'Lowe\'s Companies, Inc.<br/>' +
                'Attn:  Transactional Accounting (APS)<br/>' +
                '1000 Lowe\'s Blvd.,<br/>' +
                'Morresville, NC 28117<br/>' +
                'Phone Number: 336-658-2121';
        default:
            return '';
    }
  }

  function getSpecialInstruction(customerId, addressType, shippingMethod) {
    switch (customerId) {
        case CUSTOMER.THE_HOME_DEPOT_INC:
          if (addressType === ADDRESS_TYPE.COMMERCIAL) return 'Address Corrections and/or Reconsignment must be approved by HomeDepot.com';
          if (addressType === ADDRESS_TYPE.RESIDENTIAL) return 'Residential and Liftgate charges pre-approved if required<br/>' +
              'Address Corrections and/or Reconsignment must be approved by HomeDepot.com';
          break;
        case CUSTOMER.THE_HOME_DEPOT_SPECIAL_PRO:
            if (addressType === ADDRESS_TYPE.COMMERCIAL) return 'Address Corrections and/or Reconsignment must be approved by HomeDepot.com';
            if (addressType === ADDRESS_TYPE.RESIDENTIAL) return 'Residential and Liftgate charges pre-approved if required<br/>' +
                'Address Corrections and/or Reconsignment must be approved by HomeDepot.com';
          break;
        case CUSTOMER.LOWES_HOME_CENTERS_LLC:
            if (addressType === ADDRESS_TYPE.RESIDENTIAL && shippingMethod === SHIPPING_METHOD.FEDEX_FREIGHT_PRIORITY_FEDP) return '“Basic” Delivery Service';
            if (addressType === ADDRESS_TYPE.COMMERCIAL && shippingMethod !== SHIPPING_METHOD.FEDEX_FREIGHT_PRIORITY_FEDP) return 'COMMERCIAL';
            if (addressType === ADDRESS_TYPE.RESIDENTIAL && shippingMethod !== SHIPPING_METHOD.FEDEX_FREIGHT_PRIORITY_FEDP) return 'Residential Delivery / Liftgate Approved / NO SIGNATURE REQUIRED';
    }
  }

  function escapeXml(str){
    if (str == null) return '';

    const BR_PLACEHOLDER = '__BR__';
    str = str.replace(/<br\s*\/?>/gi, BR_PLACEHOLDER);
    str = str.replace(/[&<>"]|'/g, s => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    }[s]));
    return str.replace(new RegExp(BR_PLACEHOLDER, 'g'), '<br/>');
  }

  function extractFirstNineDigits(val){
    if(!val) return '';
    const match = val.replace(/[^0-9]/g,' ').match(/(\d{9})/);
    return match ? match[1] : '';
  }
  // Use shared totals library; build carrier rows from computed lines
  function buildLineCarrierRows(soRec, customerId){
    const soId = soRec.id;
    const totals = totalsLib.computeShipmentTotals(soId, customerId);
    let carrierInfoInText = '';
    totals.lines.forEach(l => {
      carrierInfoInText += `\n<tr>\n  <td align="center" colspan="1">${l.linePalletQty || '0'}</td>\n  <td align="center" colspan="1"> PLT</td>\n  <td align="center" colspan="1">${l.lineBoxes || ''}</td>\n  <td align="center" colspan="1">Carton</td>\n  <td align="center" colspan="1">${l.lineWeight.toFixed(1)}</td>\n  <td align="center" colspan="1"></td>\n  <td align="left" colspan="6">${l.commodity}</td>\n  <td align="center" colspan="1">${escapeXml(l.nmfc)}</td>\n  <td align="center" colspan="1">${customerId === CUSTOMER.LOWES_HOME_CENTERS_LLC ? '70' : escapeXml(l.freightClass)}</td>\n</tr>`;
    });
    return { carrierInfoInText, totalHandlingUnit: totals.totalPalletQty, totalPackage: totals.totalBoxes, totalWeight: totals.totalWeight, totalPalletQty: totals.totalPalletQty };
  }

  function getAdditionalShippingInfoByCustomerAndAddressType(customerId, addressType, soTranId, po) {
    if (customerId === CUSTOMER.LOWES_HOME_CENTERS_LLC) {
      return `Sales Order: ${escapeXml(soTranId)}`;
    }
    return `Purchase Order: ${escapeXml(po)}        Sales Order: ${escapeXml(soTranId)}`;
  }

  function buildCustomerOrderInfo(soRec, customerId, totals){
    const po = soRec.getValue('otherrefnum') || '';
    let customerOrderNumber;
    if(customerId === CUSTOMER.LOWES_HOME_CENTERS_LLC){
      customerOrderNumber = extractFirstNineDigits(po);
    } else {
      customerOrderNumber = soRec.getValue(FIELD_IDS.HD_CUSTOMER_ORDER_NUM) || '';
    }
    const soTranId = soRec.getValue('tranid') || '';
    const addressType = soRec.getValue('custbody_hyc_address_type') || '';
    // single row like original pattern
    const additionalShippingInfo = getAdditionalShippingInfoByCustomerAndAddressType(customerId, addressType, soTranId, po);
    const customerOrderInfoInText = `
<tr>
  <td colspan="3" align="center">${escapeXml(customerOrderNumber)}</td>
  <td align="center" colspan="1">${totals.totalPalletQty}</td>
  <td align="center" colspan="1">${totals.totalWeight.toFixed(1)}</td>
  <td align="center" colspan="1">Y</td>
  <td colspan="8">${additionalShippingInfo}</td>
</tr>`;
    return { customerOrderInfoInText, totalPackageOfOrders: totals.totalPackage, totalWeightOfOrders: totals.totalWeight.toFixed(1) };
  }

  function getShippingMethodAndScac(shipMethodId) {
    const obj = search.lookupFields({
      type: 'shipItem',
      id: shipMethodId,
      columns:
          ['displayname', 'itemid']
    });
    log.debug('id',shipMethodId);
    log.debug('result', obj);
    return{
      shippingMethod: obj.itemid || '',
      scac: obj.displayname || ''
    }
  }

  function generatePdfXml(params){
    const soId = params.salesorderid;
    const repeat = params.repeat || 1; // default to 1 if not provided
    if(!soId) throw new Error('Missing salesorderid parameter');
    const ifId = params.ifid; // optional

    const soRec = record.load({ type: record.Type.SALES_ORDER, id: soId, isDynamic:false });
    let dateOfExportation;
    if(ifId){
      try { dateOfExportation = record.load({ type: record.Type.ITEM_FULFILLMENT, id: ifId, isDynamic:false }).getValue('trandate'); } catch(e){ dateOfExportation = soRec.getValue('trandate'); }
    } else { dateOfExportation = soRec.getValue('trandate'); }
    //month/date/year instead of year/month/date
    dateOfExportation = new Date(dateOfExportation).toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$1/$2/$3'); // format to MM/DD/YYYY

    const customerId = (soRec.getValue('entity') || '').toString();
    const addressType = soRec.getValue('custbody_hyc_address_type') || '';
    const shippingMethodInValue = soRec.getValue('shipmethod') || '';
    const shipTo = soRec.getValue('shipaddress') || '';
    const storeNumber = soRec.getValue('custbody_hyc_shipping_store_number') || '';
    const {shippingMethod, scac } = getShippingMethodAndScac(soRec.getValue('shipmethod'));
    const proNumber = soRec.getValue(FIELD_IDS.PRO_NUMBER) || '';

    const { carrierInfoInText, totalHandlingUnit, totalPackage, totalWeight, totalPalletQty } = buildLineCarrierRows(soRec, customerId);
    const customerInfo = buildCustomerOrderInfo(soRec, customerId, { totalPackage, totalPalletQty, totalWeight });

    const shipmentInfo = { // placeholders for template compatibility
      bolNo: '',
      bolCarrierName: shippingMethod,
      bolTrailerNo: '',
      bolSealNumber: '',
      bolFreightChargeTerms: '3rd Party',
      bolCommoditySpecialInstruction: '',
      thridPartyFreightCrahgesBillTo: ''
    };

    const xmlTitle = `<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">`;
    const xml = `<pdf>
  <head>
    <style type="text/css">
      *{ font-family: arial; }
      table{ table-layout:fixed; width:100%; font-size:10px; }
      .mainTable td{ border:1px solid lightgrey }
      .inTableTitle{ font-weight:bold; font-size:12px; }
      .inTableSmallTitle{ font-weight:bold; font-size:10px; }
      .inTableSubtitle{ font-size:12px; }
      .leftUpper{ position:absolute; top:0; left:0; }
      .leftUpperTitle{ font-weight:bold; font-size:25px; }
      .blackTitle{ background:black; color:white; font-weight:bold; }
      .listTableHeader{ font-weight:bold; }
      .greyField{ background:lightgrey; }
      .underlineText{ color:black; font-weight:bold; }
      .noBorderTable td{ border:none; font-size:9px; line-height:15px; }
      .noLRBorderTable td{ border-left:none; border-right:none; }
      .checkboxText{ padding-left:3px; }
    </style>
  </head>
  <body padding="0.5in 0.5in 0.5in 0.5in" size="A4">
    <table class="mainTable">
      <tbody>
        <tr>
          <td colspan="7" rowspan="2" style="border:none;" class="leftUpperTitle">Bill of Lading</td>
          <td colspan="7" style="border:none;"></td>
        </tr>
        <tr>
          <td colspan="7">
            <span class="inTableTitle">Date: </span><span> ${escapeXml(dateOfExportation)}</span>
          </td>
        </tr>
        <tr>
          <td colspan="7">
            <table class="noLRBorderTable" style="height:30vh;">
              <tbody>
                <tr>
                  <td style="position:relative; border-top:none;">
                    <span class="inTableTitle leftUpper">Ship From: </span><br/>
                    <span class="placeholder">Water Creation<br/>701 Auto Center Drive<br/>Ontario, CA 91761<br/>909-773-1777</span><br/>
                    <p>
                      <span style="padding-right:50px">
                        <span class="inTableSubtitle">SID#: </span><span class="placeholder"></span>
                      </span>
                      <input display="inline" type="checkbox" name="FOB1"/>
                      <span class="inTableSubtitle checkboxText">FOB</span>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="position:relative;">
                    <span class="inTableTitle leftUpper">Ship To: </span><br/>
                    <table width="100%" >
                        <tbody>
                          <tr>
                          <td class="placeholder" style="border-collapse:collapse; border:none;">${escapeXml(shipTo).replace(/\n/g,'<br/>')}</td>
                          <td  style="border-collapse:collapse; border:none;">Store: ${storeNumber}</td>
                          </tr>
                        </tbody>
                    </table>
                    <p>
                      <span style="padding-right:50px">
                        <span class="inTableSubtitle">CID#: </span><span class="placeholder"></span>
                      </span>
                      <input display="inline" type="checkbox" name="FOB2"/>
                      <span class="inTableSubtitle checkboxText">FOB</span>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="position:relative; border-bottom:none;">
                    <span class="inTableTitle leftUpper">Third Party Freight Charges - Bill To: </span><br/>
                    <p class="placeholder">${escapeXml(getThirdPartyFreightChargesBillTo(customerId))}</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
          <td colspan="7">
            <table class="noLRBorderTable" style="height:30vh;">
              <tbody>
                <tr>
                  <td style="border-top:none;">
                    <span class="inTableTitle">Bill of Lading No: </span><br/>
                    <!--${shipmentInfo.bolNo ? `${escapeXml(shipmentInfo.bolNo)}<br/><qrcode codetype="code128" value="${escapeXml(shipmentInfo.bolNo)}"/>` : ''}
                    ${shipmentInfo.bolNo ? `<barcode codetype="qrcode" showtext="false" height="40" width="40" value="${escapeXml(shipmentInfo.bolNo)}"/>` : ''}-->
                    <p align="center" valign="middle" style="font-size:18px; font-weight:bold; color:#B7B7B7">BARCODE SPACE</p>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span class="inTableTitle">Carrier Name: </span><span class="fillingTextStyle2">${escapeXml(shipmentInfo.bolCarrierName)}</span><br/>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span class="inTableTitle">Trailer No: </span><span class="fillingTextStyle2">${escapeXml(shipmentInfo.bolTrailerNo)}</span><br/>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span class="inTableTitle">Seal Number(s): </span><span class="fillingTextStyle2">${escapeXml(shipmentInfo.bolSealNumber)}</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span class="inTableTitle">SCAC: </span><span>${escapeXml(scac)}</span><br/>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span class="inTableTitle">Pro No: </span>${escapeXml(proNumber)}<br/>
                    <barcode codetype="code128" value="${escapeXml(proNumber)}"/><br/><br/>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span class="inTableTitle">Freight Charge Terms </span><span>(prepaid unless marked otherwise)</span><br/>
                    <input display="inline" type="checkbox" name="Prepaid" ${shipmentInfo.bolFreightChargeTerms==='Prepaid'?'checked="true"':''}/><span class="inTableTitle checkboxText">Prepaid</span>
                    <input display="inline" type="checkbox" name="Collect" ${shipmentInfo.bolFreightChargeTerms==='Collect'?'checked="true"':''}/><span class="inTableTitle checkboxText">Collect</span>
                    <input display="inline" type="checkbox" name="3rdParty" ${shipmentInfo.bolFreightChargeTerms==='3rd Party'?'checked="true"':''}/><span class="inTableTitle checkboxText">3rd Party</span>
                  </td>
                </tr>
                <tr>
                  <td style="border-bottom:none;">
                    <input display="inline" type="checkbox" name="MasterBOL"/>
                    <span class="inTableTitle checkboxText">Master BOL: w/attached underlying BOLs</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
        <tr>
          <td colspan="14" style="height:5vh; position:relative;">
            <span class="inTableTitle leftUpper" style="font-size:10px;">Special Instructions: </span><br/>
            <span class="fillingTextStyle2">${escapeXml(getSpecialInstruction(customerId, addressType, shippingMethodInValue))}</span>
          </td>
        </tr>
        <tr>
          <td class="blackTitle" colspan="14" align="center">Customer Order Information</td>
        </tr>
        <tr>
          <td align="center" colspan="3" class="listTableHeader">Customer Order No.</td>
          <td align="center" colspan="1" class="listTableHeader"># Pkgs.</td>
          <td align="center" colspan="1" class="listTableHeader">Weight<br/>(LBS)</td>
          <td align="center" colspan="1" class="listTableHeader">Pallet/Slip<br/>(Y/N)</td>
          <td align="center" colspan="8" class="listTableHeader">Additional Shipper Info</td>
        </tr>
        ${customerInfo.customerOrderInfoInText}
        <!--<tr>        
          <td colspan="3" class="listTableHeader">Totals</td>
          <td colspan="1">${customerInfo.totalPackageOfOrders}</td>
          <td colspan="1">${customerInfo.totalWeightOfOrders}</td>
          <td colspan="9" class="greyField"></td>
        </tr>-->
        <tr>
          <td class="blackTitle" colspan="14" align="center">Carrier Information</td>
        </tr>
        <tr>
          <td align="center" colspan="2" class="listTableHeader">Handling Unit</td>
          <td align="center" colspan="2" class="listTableHeader">Package</td>
          <td align="center" colspan="2" class="listTableHeader"></td>
          <td align="center" colspan="6" class="listTableHeader">Commodity Description</td>
          <td align="center" colspan="2" class="listTableHeader">LTL Only</td>
        </tr>
        <tr>
          <td align="center" colspan="1" class="listTableHeader">QTY</td>
          <td align="center" colspan="1" class="listTableHeader">TYPE</td>
          <td align="center" colspan="1" class="listTableHeader">QTY</td>
          <td align="center" colspan="1" class="listTableHeader">TYPE</td>
          <td align="center" colspan="1" class="listTableHeader">Weight</td>
          <td align="center" colspan="1" class="listTableHeader">H.M.(X)</td>
          <td align="center" colspan="6">
            <span style="font-size:8px;">Commodities requiring special or additional care or attention in handling or stowing must be so marked and packaged as to ensure safe transportation with ordinary care.</span>
            <span style="font-weight:bold; font-size:8px;">See Section 2(e) of MNMFC Item 360</span>
          </td>
          <td align="center" colspan="1" class="listTableHeader"><span>NMFC<br/>No.</span></td>
          <td align="center" colspan="1" class="listTableHeader">Class</td>
        </tr>
        ${carrierInfoInText}
        <tr>
        
          <td align="center" colspan="1">${totalHandlingUnit}</td>
          <td align="center" colspan="1" class="greyField"></td>
          <td align="center" colspan="1">${totalPackage}</td>
          <td align="center" colspan="1" class="greyField"></td>
          <td align="center" colspan="1">${Number(totalWeight).toFixed(1)}</td>
          <td align="center" colspan="1" class="greyField"></td>
          <td align="left" colspan="6"><span class="inTableTitle">Totals</span></td>
          <td align="center" colspan="2" class="greyField"></td>
        </tr>
        <tr>
          <td colspan="7" align="left">
            <span>Where the rate is dependent on value, shippers are required to state specifically in writingthe agreed or declared value of the property as follows: <br/>"The agreed or declared value of the property is specifically stated by the shipper to be notexceeding</span><br/>
            <span class="underlineText">_________________________</span><span>FOB</span><span class="underlineText">______________________</span><span>."</span>
          </td>
          <td colspan="7">
            <span class="inTableTitle">COD Amt. $</span><span class="underline">_________________________________</span><br/>
            <span class="inTableTitle">Fee Terms: </span>
            <input display="inline" type="checkbox" name="Collect2"/>
            <span class="inTableSubtitle checkboxText">Collect</span>
            <input display="inline" type="checkbox" name="Prepaid2"/>
            <span class="inTableSubtitle checkboxText">Prepaid</span><br/>
            <input display="inline" type="checkbox" name="CCA"/>
            <span class="inTableSubtitle checkboxText">Customer Check Acceptable</span>
          </td>
        </tr>
        <tr>
          <td colspan="14">
            <span class="inTableTitle">NOTE: </span>
            <span> Liability Limitation for loss or damage in this shipment may be applicable. See 49 U.S.C. - 14706(c)(1)(A) and (B).</span>
          </td>
        </tr>
        <tr>
          <td colspan="7">
            <span>RECEIVED, subject to individually determined rates or contracts that have been agreed upon in writing between the carrier and shipper, if applicable, otherwise to the rates, classifications and rules that have been established by the carrier and are available to the shipper, on request, and to all applicable state and federal regulations.</span>
          </td>
          <td colspan="7">
            <span>The carrier shall not make delivery of this shipment without payment of freight and all other lawful charges.</span><br/><br/>
            <span class="inTableSubtitle">Shipper Signature</span><span class="underlineText">___________________________</span>
          </td>
        </tr>
        <tr>
          <td colspan="5">
            <span>This is to certify that the above named materials are properly classified, packaged, marked and labeled, and are in proper condition for transportation according to the applicable regulations of the DOT.</span><br/>
            <br/><br/><span class="underlineText">______________________</span><span> </span><span class="underlineText">____________</span><br/>
            <span>Shipper Signature</span><span style="padding-left:40px;">Date</span>
          </td>
          <td colspan="4">
            <table class="noBorderTable">
              <tbody>
                <tr>
                  <td colspan="2">
                    <span class="inTableSmallTitle">Trailer Loaded</span><br/>
                    <input display="inline" type="checkbox" name="BS2"/><span class="checkboxText">By Driver</span><br/>
                    <input display="inline" type="checkbox" name="BS1"/><span class="checkboxText">By Shipper</span><br/>
                  </td>
                  <td colspan="2">
                    <span class="inTableSmallTitle">Freight Counted</span><br/>
                    <input display="inline" type="checkbox" name="BS3"/><span class="checkboxText">By Shipper</span><br/>
                    <input display="inline" type="checkbox" name="BS4"/><span class="checkboxText">By Driver/pallets said to contain</span><br/>
                    <input display="inline" type="checkbox" name="BS5"/><span class="checkboxText">By Driver/Pieces</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
          <td colspan="5">
            <span>Carrier acknowledges receipt of packages and required placards. Carrier certifies emergency response information was made available and/or carrier has the DOT emergency response guidebook or equivalent documentation in the vehicle. Property described above is received in good order, except as noted.</span><br/>
            <span class="underlineText">______________________</span><span> </span><span class="underlineText">____________</span><br/>
            <span>Carrier Signature</span><span style="padding-left:45px;">Pickup Date</span>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</pdf>`;
    if(repeat > 1){
        const repeatingElements = Array(Number(repeat)).fill(xml);
        return xmlTitle + `<pdfset>${repeatingElements.join('')}</pdfset>`;
    }
    return xmlTitle + xml;
  }

  function onRequest(ctx){
    try {
      if(ctx.request.method === 'GET'){
        const xml = generatePdfXml(ctx.request.parameters || {});
        ctx.response.renderPdf(xml);
      } else { ctx.response.write('Unsupported method'); }
    } catch(error){
      log.error({title:''+error.name, details:`Error Message: ${error.message} | Error Stack: ${error.stack}`});
      ctx.response.write('Error generating BOL');
    }
  }

  return { onRequest };
});
