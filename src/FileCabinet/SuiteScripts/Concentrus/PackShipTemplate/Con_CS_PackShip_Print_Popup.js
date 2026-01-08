/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */

define(['N/currentRecord', 'N/record', 'N/https', 'N/url', 'N/runtime', 'N/search','./Con_Lib_Print_Node','./Con_Lib_PackShip_Lib','./Con_Lib_Customer_Config', '../../Hycentra/Integrations/FedEX/fedexHelper', './Con_Lib_Print_Node'],
    (currentRecord, record, https, url, runtime, search, printNode, packShipLib, customerCfg, fedexHelper, printNodeLib) => {
    const SUITELET_BOL = 'customscript_con_sl_ps_print_bol';
    const SUITELET_BOL_DEPLOY = 'customdeploy_con_sl_ps_print_bol';
    const SUITELET_HOME_DEPOT_LABEL = 'customscript_con_sl_homedepot_label_prt';
    const SUITELET_HOME_DEPOT_LABEL_DEPLOY = 'customdeploy_con_sl_homedepot_label_prt';
    const SUITELET_LOWES_LABEL = 'customscript_con_sl_lowes_home_label_prt';
    const SUITELET_LOWES_LABEL_DEPLOY = 'customdeploy_con_sl_lowes_home_label_prt';
    const SUITELET_PRINT_ALL = 'customscript_con_sl_pdf_merge_api';
    const SUITELET_PRINT_ALL_DEPLOY = 'customdeploy_con_sl_pdf_merge_api';
    const FIELD_PRO_NUMBER = 'custbody_pro_number';
    const CUSTOMER = customerCfg.CUSTOMER;
    const REPORT_TYPE = {
        'PACKING_SLIP': 'Packing Slip',
        'BILL_OF_LADING': 'Bill of Lading',
        'UCC_LABEL': 'UCC Label',
    };
    const ADDRESS_TYPE = {
        RESIDENTIAL: '1',
        COMMERCIAL: '2',
    }

    const LOWES_FULL_SET = new Set(['10443', '3771', '11596', '36', '46']);            // BOL + UCC + Packing Slip
    const LOWES_PACKING_ONLY_SET = new Set(['9', '3788', '10749', '10750', '9607']);   // Packing Slip only

    function evaluatePrintAllCriteria(customerId, shipMethodId, addressType) {
        const shipId = shipMethodId != null ? String(shipMethodId) : '';
        let bol = false, ucc = false, packingSlip = false, reason = '';

    if (customerCfg.isHomeDepot(customerId)) {
            bol = ucc = packingSlip = true;
            reason = 'Home Depot (all carriers allow all templates)';
        } else if (customerId === CUSTOMER.LOWES_HOME_CENTERS_LLS) {
            if (LOWES_FULL_SET.has(shipId)) {
                bol = ucc = packingSlip = true;
                if(addressType === ADDRESS_TYPE.RESIDENTIAL) ucc = false; // Residential addresses do not get UCC labels
                reason = 'Lowe\'s + full carrier set';
            } else if (LOWES_PACKING_ONLY_SET.has(shipId)) {
                packingSlip = true;
                reason = 'Lowe\'s + packing-slip-only carrier';
            } else {
                // Unknown carrier for Lowe's: default conservative (only packing slip)
                packingSlip = true;
                reason = 'Lowe\'s + unclassified carrier (default to Packing Slip only)';
            }
        } else {
            reason = 'Customer not in Print All program';
        }
        console.log('Rule applied:', reason, '| BOL:', bol, '| UCC:', ucc, '| Packing Slip:', packingSlip);

        return {
            bol,
            ucc,
            packingSlip,
        };
    }

    function ensureStyles() {
        if (document.getElementById('con-ps-modal-style')) return;
        const style = document.createElement('style');
        style.id = 'con-ps-modal-style';
        style.textContent = `
      .con-ps-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:10000; display:flex; align-items:center; justify-content:center; }
      .con-ps-modal { background:#fff; border-radius:8px; width:420px; max-width:90%; padding:20px 22px 24px; box-shadow:0 8px 28px rgba(0,0,0,.35); font-family:Arial, Helvetica, sans-serif; }
      .con-ps-modal h2 { margin:0 0 12px; font-size:18px; }
      .con-ps-modal label { display:block; font-size:12px; color:#555; margin-bottom:4px; text-transform:uppercase; letter-spacing:.5px; }
      .con-ps-modal input[type=text] { width:100%; padding:8px 10px; font-size:14px; border:1px solid #bbb; border-radius:4px; box-sizing:border-box; }
      .con-ps-modal input[type=text]:focus { outline:none; border-color:#2684ff; box-shadow:0 0 0 2px rgba(38,132,255,0.3); }
      .con-ps-actions { margin-top:18px; text-align:right; display:flex; gap:10px; justify-content:flex-end; }
      .con-ps-btn { cursor:pointer; border:0; border-radius:4px; padding:8px 16px; font-size:13px; font-weight:600; }
      .con-ps-btn.cancel { background:#e0e0e0; color:#222; }
      .con-ps-btn.cancel:hover { background:#d5d5d5; }
      .con-ps-btn.primary { background:#0073aa; color:#fff; }
      .con-ps-btn.primary:hover { background:#005f8a; }
      .con-ps-error { color:#c62828; font-size:12px; margin-top:6px; display:none; }
      .con-ps-modal.closing { animation: conPsFadeOut .18s ease forwards; }
      .con-ps-overlay.closing { animation: conPsOverlayFade .18s ease forwards; }
      @keyframes conPsFadeOut { to { opacity:0; transform:translateY(-6px); } }
      @keyframes conPsOverlayFade { to { opacity:0; } }
    `;
        document.head.appendChild(style);
    }

    function closeModal() {
        const overlay = document.querySelector('.con-ps-overlay');
        if (!overlay) return;
        overlay.classList.add('closing');
        const modal = overlay.querySelector('.con-ps-modal');
        if (modal) modal.classList.add('closing');
        setTimeout(() => overlay.remove(), 180);
        document.removeEventListener('keydown', escListener, true);
    }

    function escListener(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    }

    function createModal(onConfirm) {
        ensureStyles();
        // Prevent duplicate
        closeModal();
        const overlay = document.createElement('div');
        overlay.className = 'con-ps-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        const modal = document.createElement('div');
        modal.className = 'con-ps-modal';
        modal.innerHTML = `
      <h2>Enter PRO / Tracking Number</h2>
      <label for="con-ps-pro-input">PRO / Tracking</label>
      <input id="con-ps-pro-input" type="text" autocomplete="off" placeholder="Enter value" />
      <div class="con-ps-error" id="con-ps-pro-error">Value is required.</div>
      <div class="con-ps-actions">
        <button type="button" class="con-ps-btn cancel" id="con-ps-cancel">Cancel</button>
        <button type="button" class="con-ps-btn primary" id="con-ps-confirm">Confirm</button>
      </div>`;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        const input = modal.querySelector('#con-ps-pro-input');
        const err = modal.querySelector('#con-ps-pro-error');
        const confirmBtn = modal.querySelector('#con-ps-confirm');
        const cancelBtn = modal.querySelector('#con-ps-cancel');

        function submit() {
            const val = (input.value || '').trim();
            if (!val) {
                err.style.display = 'block';
                input.focus();
                return;
            }
            onConfirm(val);
            closeModal();
        }

        confirmBtn.addEventListener('click', submit);
        input.addEventListener('keypress', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
        });
        cancelBtn.addEventListener('click', closeModal);
        setTimeout(() => input.focus(), 30);
        document.addEventListener('keydown', escListener, true);
    }

    function getHidden(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    function savePro(value) {
        const currec = currentRecord.get();
        const soId = currec.getValue('createdfrom');
        record.submitFields({
            type: record.Type.SALES_ORDER,
            id: soId,
            values: {[FIELD_PRO_NUMBER]: value},
        });

         // Check if it's Home Depot / Lowes customer
         const customerId = getHidden('custpage_con_ps_customer');
         const shipMethodId = getHidden('custpage_con_ps_shipmethod');
         if (customerCfg.isHomeDepot(customerId) || (customerCfg.isLowes(customerId) && shipMethodId !== '3788')) {
             // call print all function
             conPsPrintAll();
         } else if (customerCfg.isLowes(customerId) && shipMethodId === '3788') {
            // Print Packing Slip for Lowe's with 3788 (Pilot) ship method ONLY
            const packingSlipUrl = printPackingSlipWithApi(true);
            if (packingSlipUrl){
                printNode.printByPrintNode('Printing Packing Slip From NS', packingSlipUrl, REPORT_TYPE.PACKING_SLIP, 1);
            }
         }
 
         // Mark Item Fulfillment status as shipped
         const ifId = getHidden('custpage_con_ps_ifid');
         if (ifId) {
             record.submitFields({
                 type: record.Type.ITEM_FULFILLMENT,
                 id: ifId,
                 values: {shipstatus: 'C'},
             });
         }

        location.reload();
    }

    function conPsEnterPro() {
        createModal(savePro);
    }

    function openSuitelet(scriptId, deploymentId, salesorderId, repeat, returnUrl) {
        const params = Object.assign({ifid: currentRecord.get().id, salesorderid: salesorderId, repeat: repeat ?? 1});
        const suiteletUrl = url.resolveScript({scriptId, deploymentId, params, returnExternalUrl: true});
        if (returnUrl) return suiteletUrl;
        //prevent some browsers block this
        const newTab = window.open('about:blank');
        newTab.location = suiteletUrl;
    }

    function conPsPrintBOL(copies, returnUrl) {
        const soId = getHidden('custpage_con_ps_soid');
        copies = copies || 2; // Default to 2 if not provided
        return openSuitelet(SUITELET_BOL, SUITELET_BOL_DEPLOY, soId, copies, returnUrl);
    }

    function conPsPrintUCC(copies, returnUrl) {
        const soId = getHidden('custpage_con_ps_soid');
        const customerId = getHidden('custpage_con_ps_customer');
    if (customerCfg.isHomeDepot(customerId)) {
            return openSuitelet(SUITELET_HOME_DEPOT_LABEL, SUITELET_HOME_DEPOT_LABEL_DEPLOY, soId, copies, returnUrl);
        } else if (customerId === CUSTOMER.LOWES_HOME_CENTERS_LLS) {
            return openSuitelet(SUITELET_LOWES_LABEL, SUITELET_LOWES_LABEL_DEPLOY, soId, copies, returnUrl);
        }
    }

    function conPsPrintPackSlip() {
        const soId = getHidden('custpage_con_ps_soid');
        if (!soId) return;
        const url3p = search.lookupFields({
            type: record.Type.SALES_ORDER,
            id: soId,
            columns:
                ['custbody_lb_packingslip']
        })['custbody_lb_packingslip'];
        if (!url3p || url3p === '') {
            alert('Packing Slip URL not found for this Sales Order.');
            return;
        }
        const newTab = window.open('about:blank');
        newTab.location = url3p;
    }

    function repeatStringToList(str, n) {
        return Array(n).fill(str);
    }

    // Use shared totals library for accurate counts (line values multiplied by quantity)
    function computeTotalsForPrintAll() {
        const soId = getHidden('custpage_con_ps_soid');
        const customerId = getHidden('custpage_con_ps_customer');
        if (!soId) return { totalBoxes:0, totalPalletQty:0, totalWeight:0 };
        const { totalBoxes, totalPalletQty, totalWeight } = packShipLib.computeShipmentTotals(soId, customerId);
        return { totalBoxes, totalPalletQty, totalWeight };
    }

    async function conPsPrintAll() {
        const customerId = getHidden('custpage_con_ps_customer');
        const shipMethodId = getHidden('custpage_con_ps_shipmethod');
        const scac = getHidden('custpage_con_ps_scac');
        const addressType = getHidden('custpage_con_ps_address_type');
        const {bol, ucc, packingSlip} = evaluatePrintAllCriteria(customerId, shipMethodId, addressType);
        const printUrls = [];

        // Derive copies from totals computed like the BOL Suitelet
    const { totalBoxes, totalPalletQty } = computeTotalsForPrintAll();
    // Copies rules:
    //  - BOL: at least 2, using totalPalletQty + 2 as per previous logic
    //  - UCC: Lowe's => totalBoxes, others => totalPalletQty
    //  - Packing Slip: totalPalletQty (min 1)
    const bolCount = Math.max(2, (Number(totalPalletQty) || 0) + 2);
    const uccBase = (customerCfg.isLowes(customerId)) ? Number(totalBoxes) : Number(totalPalletQty);
    const uccCount = 1;//update 0820: assume the label handle the boxes/pallets part by pdf repeat so no handle it twice
        // Math.max(1, uccBase || 0);
    const packingSlipCount = Math.max(1, Number(totalPalletQty) || 0);

        if (bol) {
            printNode.printByPrintNode('Printing BOL From NS', conPsPrintBOL(bolCount, true), REPORT_TYPE.BILL_OF_LADING);
        }
        if (ucc) {
            printNode.printByPrintNode('Printing Label From NS', conPsPrintUCC(uccCount, true), REPORT_TYPE.UCC_LABEL);
        }

        const packingSlipUrl = printPackingSlipWithApi(true);
        if (packingSlip && packingSlipUrl){
            printNode.printByPrintNode('Printing Packing Slip From NS', packingSlipUrl, REPORT_TYPE.PACKING_SLIP, packingSlipCount);
        }
        // if (printUrls.length === 0) return;
        // if (packingSlip) printUrls.push(conPsPrintPackSlip());
        // create a record in type customrecord_con_merge_print_request
        // const mergeRequest = record.create({
        //     type: 'customrecord_con_merge_print_request',
        //     isDynamic: true
        // });
        // mergeRequest.setValue({
        //     fieldId: 'custrecord_con_mp_print_rq_urls',
        //     value: printUrls.join('\n')
        // });
        // const mergeRequestId = mergeRequest.save();
        // const printAllSuiteletUrl = url.resolveScript({
        //     scriptId: SUITELET_PRINT_ALL,
        //     deploymentId: SUITELET_PRINT_ALL_DEPLOY,
        //     params: {
        //         mergeRequestId: mergeRequestId
        //     },
        // });
        // window.open(printAllSuiteletUrl, '_blank');
    }

    function printPackingSlipWithApi(returnUrl) {
        //TODO: use suite secret to get api_key
        const API_KEY = '94A4C1E1-0327-43D5-8F2F-7C22CBC7B3EF';
        const soId = getHidden('custpage_con_ps_soid');
        if (!soId) return;
        const url3p = search.lookupFields({
            type: record.Type.SALES_ORDER,
            id: soId,
            columns:
                ['custbody_lb_packingslip']
        })['custbody_lb_packingslip'];
        if (!url3p || url3p === '') {
            alert('Packing Slip URL not found for this Sales Order.');
            return;
        }
        //the url may look like this:
        //https://portal.logicbroker.com/areas/logicbroker/picklist.ashx?logicbrokerkeys=250521404&filetype=pdf&viewinbrowser=true
        //extract the logicbrokerkeys value
        const logicbrokerKeysMatch = url3p.match(/logicbrokerkeys=([^&]+)/);
        if (!logicbrokerKeysMatch || logicbrokerKeysMatch.length < 2) {
            alert('Packing Slip URL is not valid. Please check the URL.');
            return;
        }
        const orderId = logicbrokerKeysMatch[1];
        if (!orderId) {
            alert('Order ID not found in Packing Slip URL.');
            return;
        }
        const url = `https://commerceapi.io/api/v3/Orders/${orderId}/PickList?FileType=pdf&ViewInBrowser=true`;
        try {
            const response = https.get({
                url: url,
                headers: {
                    'Accept': 'application/json',
                    'SubscriptionKey': API_KEY
                }
            });

            // return like this:
            //{
            //   "Body": "https://commerceapi.io/api/v3/Orders/250521404/PickList?imagetoken=c86629e5-e479-49ef-ab5a-c58cd7e5005f"
            // }
            if (response.code === 200) {
                const url = JSON.parse(response.body).Body;
                if (returnUrl) return url;
                // Open the URL in a new tab
                const newTab = window.open('about:blank');
                newTab.location = url;
            } else {
                console.error('HTTP Error', `Order ${orderId} returned status ${response.code}`);
            }
        } catch (error) {
            console.error('get pack list', error);
        }
    }

    function conPsPrintFedexLabel(){
        const res = confirm('This will print FedEx label(s) for this Item Fulfillment. Are you sure you want to continue?');
        if (!res) return;
        //COPY from Con_UE_Update_SSCC_Number.js
        //Just for testing purpose, will be removed later
        const ifId = currentRecord.get().id;
        const ifRec = record.load({
            type: record.Type.ITEM_FULFILLMENT,
            id: ifId,
            isDynamic: false
        });
        const labelUrls = ifRec.getValue('custbody_shipping_label_url');
        console.log('FedEx label URLs:', labelUrls);
        const domain = url.resolveDomain({
            hostType: url.HostType.APPLICATION,
            accountId: runtime.accountId
        });
        // Handle both new ||| delimiter and legacy comma delimiter for backward compatibility
        // New format uses ||| because FedEx URLs contain commas
        // Legacy format used comma but only works for File Cabinet URLs (not FedEx URLs)
        let urls;
        if (labelUrls.indexOf('|||') !== -1) {
            // New format with ||| delimiter
            urls = labelUrls.split('|||');
        } else {
            // Legacy comma delimiter (only safe for File Cabinet URLs)
            urls = labelUrls.split(',');
        }
        if(urls.length === 1 && urls[0] === '') {
            alert('No FedEx label URL found for this Item Fulfillment.');
            return;
        }
        urls.forEach((labelUrl) => {
            if(labelUrl === '') return; // skip empty URLs
            // Handle both File Cabinet URLs (relative) and FedEx URLs (absolute)
            const fullUrl = labelUrl.startsWith('http') ? labelUrl : domain + labelUrl;
            console.log('FedEx label URL:', fullUrl);
            printNodeLib.printByPrintNode('Print Fedex Label from NS', fullUrl, 'FedEx Label', 1);
        });
        alert('FedEx label(s) sent to the printer.');
    }

    function pageInit() {
    }

    /**
     * Retry downloading FedEx labels from stored original URLs
     * Used when initial download failed but shipment was created successfully
     */
    function conPsRetryLabelDownload() {
        const confirmed = confirm('This will retry downloading the FedEx label(s) that failed previously. Continue?');
        if (!confirmed) return;

        try {
            const ifId = currentRecord.get().id;
            console.log('Retrying label download for Item Fulfillment:', ifId);

            // Call the fedexHelper retry function
            const result = fedexHelper.retryLabelDownload(ifId);

            if (result.success) {
                alert('Label download successful!\n\n' + result.message);
                location.reload(); // Refresh to update button visibility
            } else {
                alert('Label download completed with issues:\n\n' + result.message);
                location.reload();
            }
        } catch (e) {
            console.error('Retry label download error:', e);
            alert('Error retrying label download: ' + e.message);
        }
    }

    /**
     * Re-create FedEx shipment (creates new tracking number and label)
     * Use with caution - this creates a completely new shipment
     */
    function conPsRecreateShipment() {
        const confirmed = confirm(
            '⚠️ WARNING: This will create a NEW FedEx shipment with a NEW tracking number.\n\n' +
            'The previous shipment will still exist in FedEx\'s system.\n\n' +
            'Only use this if:\n' +
            '• The original shipment failed completely, OR\n' +
            '• You need to void and recreate the shipment\n\n' +
            'Are you sure you want to continue?'
        );
        if (!confirmed) return;

        try {
            const ifId = currentRecord.get().id;
            console.log('Re-creating shipment for Item Fulfillment:', ifId);

            // Load the fulfillment record
            const ifRec = record.load({
                type: record.Type.ITEM_FULFILLMENT,
                id: ifId,
                isDynamic: false
            });

            // Call the fedexHelper createShipment function
            const result = fedexHelper.createShipment(ifRec, false);

            if (result.success) {
                alert('Shipment created successfully!\n\nTracking Number: ' + (result.trackingNumber || 'See record'));
                location.reload();
            } else {
                alert('Shipment creation failed:\n\n' + (result.message || result.error || 'Unknown error'));
            }
        } catch (e) {
            console.error('Re-create shipment error:', e);
            alert('Error re-creating shipment: ' + e.message);
        }
    }

    return {
        pageInit,
        conPsEnterPro,
        conPsPrintAll,
        conPsPrintBOL,
        conPsPrintUCC,
        conPsPrintPackSlip,
        printPackingSlipWithApi,
        conPsPrintFedexLabel,
        conPsRetryLabelDownload,
        conPsRecreateShipment
    };
});
