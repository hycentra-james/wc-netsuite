/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/record', 'N/render', 'N/file', 'N/log', '../../Hycentra/ItemFulfillment/SSCC_Helper','./Con_Lib_PackShip_Lib'], function (search, record, render, file, log, ssccHelper, packShipLib) {

    class Address {
        constructor(shippingAddressSubRecord) {
            const result = {
                name: shippingAddressSubRecord.getValue({ fieldId: 'addressee' }),       // Recipient name
                attention: shippingAddressSubRecord.getValue({ fieldId: 'attention' }), // Optional
                addr1: shippingAddressSubRecord.getValue({ fieldId: 'addr1' }),
                addr2: shippingAddressSubRecord.getValue({ fieldId: 'addr2' }),
                city: shippingAddressSubRecord.getValue({ fieldId: 'city' }),
                state: shippingAddressSubRecord.getValue({ fieldId: 'state' }),
                zip: shippingAddressSubRecord.getValue({ fieldId: 'zip' }),
                country: shippingAddressSubRecord.getValue({ fieldId: 'country' })
            };
            this.name = result.name;
            this.address = result.addr1 + result.addr2
            this.address2 = `${result.city}, ${result.state} ${result.zip}`
            this.zip = result.zip;
            this.country = result.country;
            this.completeAddress2 = `${this.address}<br />${this.address2} ${this.country}`
        }
    }

    function buildShipUnitCountStringsFromLines(lines) {
        const list = [];
        (lines || []).forEach(l => {
            const boxes = Number(l.lineBoxes) || 0;
            const pallets = Number(l.linePalletQty) || 0;
            let units = 0;
            if (boxes > 0) units = boxes; // Lowe's uses boxes as shipping units
            else if (pallets > 0) units = pallets; // fallback to pallets if no boxes metadata
            else units = Number(l.quantity) || 0; // final fallback to quantity
            if (units > 0) {
                for (let i=1;i<=units;i++) list.push(`${i} OF ${units}`);
            }
        });
        return list.length ? list : ['1 OF 1'];
    }


    function getSSCCFromFirstItemRowOfTheItemFulfillment(salesOrderId) {
        const { ssccRaw } = packShipLib.getFirstLineSSCCBySalesOrder(salesOrderId);
        return ssccRaw || '';
    }

    function updateSSCCList(ssccList, codesLine) {
        log.debug('updateSSCCList - before', ssccList);
        log.debug('updateSSCCList - before2', codesLine);
        // Before Lowe's SSCC count = Number of Boxes * Qty, Copies from Number of Boxes * Qty
        // Now Lowe's SSCC count = Pallet Qty * Qty, Copies from Number of Boxes * Qty
        // Duplicate the SSCC codes based on Boxes(As Qty already considered in SSCC generation)
        const updatedSSCCList = [];
        for (const raw in codesLine) {
            if (!raw) continue;
            const entry = codesLine[raw];
            const boxes = Number(entry.boxes) || 0;
            for (let i=0;i<boxes;i++) {
                updatedSSCCList.push(raw);
            }
        }
        log.debug('updateSSCCList - after', updatedSSCCList);
        return updatedSSCCList;
    }

    function onRequest(context) {
        if (context.request.method === 'GET') {
            try {
                // Get sales order ID from parameter
                const salesOrderId = context.request.parameters.salesorderid;
                let repeating = 1;
                if (context.request.parameters.hasOwnProperty('repeat')) {
                    repeating = Number(context.request.parameters.repeat);
                }

                if (!salesOrderId) {
                    context.response.write('Error: Sales Order ID parameter is required');
                    return;
                }

                // Load the sales order record
                const so = record.load({
                    type: record.Type.SALES_ORDER,
                    id: salesOrderId
                });

                const shippingAddressSubRecord = so.getSubrecord({
                    fieldId: 'shippingaddress'
                });

                let shippingAddress = new Address(shippingAddressSubRecord)

                // Compute pallet-based counts from Sales Order lines
                const customerId = so.getValue('entity');
                const totals = packShipLib.computeShipmentTotals(salesOrderId, customerId);
                // All SSCC codes across fulfillment (if any)
                const { codes: allCodes , codesLine} = packShipLib.getAllSSCCBySalesOrder(salesOrderId);
                let ssccList = allCodes;
                ssccList = updateSSCCList(ssccList, codesLine);
                const ssccRaw = ssccList.join(',');
                const shipUnitCountStrings = ssccList.length ? ssccList.map((_,i)=>`${i+1} OF ${ssccList.length}`) : buildShipUnitCountStringsFromLines(totals.lines);

                const salesOrder = {
                    tranId: so.getValue('tranid'),
                    id: salesOrderId,
                    fromCompany: "Water Creation",
                    fromAddress1: "701 Auto Center Drn",
                    fromCity: "Ontario",
                    fromState: "CA",
                    fromZip: " 91761 US",
                    companyName: shippingAddress.name,
                    shipAddress: shippingAddress.completeAddress2,
                    shipZip: shippingAddress.zip,
                    shipZipNumber: shippingAddress.zip,
                    proNumber: so.getValue('custbody_pro_number'),
                    billOfLading: "", // keep it blank
                    poNumber: so.getValue('otherrefnum'),
                    sos: "SOS", // fixed value
                    sscc: ssccList[0] || '',
                    ssccList: ssccList,
                    forNumber: so.getValue('custbody_hyc_shipping_store_number') || 'empty',
                    shipUnitCountStrings: shipUnitCountStrings,
                };

                // Generate PDF using Advanced PDF/HTML template
                const pdfFile = generatePdf(salesOrder, repeating);

                // Return PDF as response
                context.response.writeFile({
                    file: pdfFile,
                    isInline: true
                });

            } catch (error) {
                log.error('Error in BOL Print Suitelet', error.toString());
                context.response.write('Error generating BOL: ' + error.message);
            }
        }
    }

    function generatePdf(salesOrder, repeating) {
        try {
            // Create the renderer
            const renderer = render.create();

            renderer.templateContent = createHtmlTemplate(salesOrder, repeating);

            // Render as PDF
            const pdfFile = renderer.renderAsPdf();
            pdfFile.name = `Lowes_Home_${salesOrder.tranId || salesOrder.id}.pdf`;

            return pdfFile;

        } catch (error) {
            log.error('Error generating PDF', error.toString());
            throw error;
        }
    }

    function createHtmlTemplate(customFieldData, repeating = 1) {
        // Extract all template variables into an object with fake values
        const newFake = {
            tranId: 'test so tran id',
            id: '12345',
            fromCompany: "Water Creation",
            fromAddress1: "701 Auto Center Drn",
            fromCity: "Ontario",
            fromState: "CA",
            fromZip: " 91761 US",
            companyName: "Customer Company Inc.",
            shipAddress: "456 Delivery Street\nShipping City, NY 10001",
            shipZip: "60174",
            shipZipNumber: "60174",
            proNumber: "PRO123456789",
            billOfLading: "", // keep it blank
            poNumber: "PO-2024-001234",
            sos: "SOS", // fixed value
            sscc: "(00)012345678901234568",
            forNumber: "(91) 01738",
            shipUnitCountStrings: {}
            // convertPallets([{
            //     id: "10001",
            //     palletQuantity: "1",
            // }, {
            //     id: "10002",
            //     palletQuantity: "2",
            // }])
            // shipUnitCountStrings: [
            //     '1 OF 1',
            //     '1 OF 2',
            //     '2 OF 2',
            // ]
        }
        const templateData = customFieldData;
        const pdfString = templateData.shipUnitCountStrings.map((shipUnitCountString, idx) => {
            const currentSscc = (templateData.ssccList && templateData.ssccList[idx]) ? templateData.ssccList[idx] : templateData.sscc;
            return `
<pdf>
<head>
    <meta name="title" value="Shipping Label"/>
    <style type="text/css">
        * {
            font-family: Arial, Helvetica, sans-serif;
        }
        
        body {
            margin: 0;
            padding: 0pt;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .header-table td {
            border: 1pt solid black;
            font-size: 8pt;
        }
        
        .label-title {
            font-size: 10pt;
        }
        
        .barcode-cell {
            text-align: center;
            padding: 8pt;
        }
        
        .large-text {
            font-size: 36pt;
        }
        
        .info-table {
        }
        
        .sos-table {
            height: 40px;
        }
        
        .info-table td {
            border: 1pt solid black;
            font-size: 9pt;
        }
        
        .barcode {
            height: 30pt;
        }
        
        .barcode-large {
            height: 40pt;
        }
        
        .address-row {
            height: 1.1in;
        }
        
        .po-row {
            height: 1.1in;
        }
        
        .sscc-row {
            height: 1.6in;
        }
    </style>
</head>

<body size="4in x 6in" margin="0.1in">
    <!-- Header Section with FROM/TO -->
    <table class="header-table">
        <tr class="address-row">
            <td width="50%" style="border-right: 0; border-bottom: 0;">
                <p class="label-title">FROM</p>
                ${templateData.fromCompany}<br/>
                ${templateData.fromAddress1}<br/>
                ${templateData.fromCity}, ${templateData.fromState} ${templateData.fromZip}
            </td>
            <td width="50%" style="border-bottom: 0;">
                <p class="label-title">TO</p>
                ${templateData.companyName}<br/>
                ${templateData.shipAddress}<br/>
            </td>
        </tr>
    </table>
    
    <!-- ZIP Code and Carrier Section -->
    <table class="info-table">
        <tr>
            <td width="50%" style="border-right: 0; border-bottom: 0;">
                <b>SHIP ZIP CODE</b> (420) ${templateData.shipZip}<br/>
                <div class="barcode-cell">
                    <barcode codetype="code128" showtext="false" value="${templateData.shipZipNumber}" class="barcode"/>
                </div>
            </td>
            <td width="50%" style="border-bottom: 0;">
                <b>CARRIER</b><br/>
                PRO: ${templateData.proNumber}<br/>
                B/L: ${templateData.billOfLading}
            </td>
        </tr>
    </table>
    
    <!-- PO Number and Ship Unit Count -->
    <table class="sos-table info-table">
        <tr class="po-row">
            <td width="70%" style="border-bottom: 0; border-right: 0;">
                <b>PO #</b> ${templateData.poNumber}<br/><br/>
                <b>SHIP UNIT COUNT</b> - ${shipUnitCountString}
            </td>
            <td width="30%" style="border-bottom: 0; border-left: 0;">
                <p class="large-text">${templateData.sos}</p>
            </td>
        </tr>
    </table>
    
    <!-- FOR Section with Item Barcode -->
    <table class="info-table">
        <tr>
            <td width="50%" style="border-right: 0; border-bottom: 0;">
                FOR (91) ${templateData.forNumber}<br/>
                <div class="barcode-cell">
                    <barcode codetype="code128" showtext="false" value="${templateData.forNumber.replace('(', '').replace(')', '').replace(' ', '')}" class="barcode"/>
                </div>
            </td>
            <td width="50%" style="border-bottom: 0;">
                #${templateData.forNumber}
            </td>
        </tr>
        <tr class="sscc-row">
            <td colspan="2">
                SSCC<br/> 
                <p align="center" style="padding: 0px;">(00) ${currentSscc}</p>
                <div class="barcode-cell" style="margin: 0 auto;" align="center">
                    <barcode codetype="code128" showtext="false" value="${currentSscc}" class="barcode-large"/>
                </div>
            </td>
        </tr>
    </table>
</body>
</pdf>
`
        })

        let elements = Array(repeating).fill('');
        let pdfs = elements.map((element, index) => pdfString).join('');
        return `<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd"><pdfset>${pdfs}</pdfset>`
    }

    function safelyExecute(func, context) {
        try {
            return func(context)
        } catch (e) {
            log.error(`error in ${func.name}`, e.toString())
        }
    }

    return {
        onRequest: (context) => safelyExecute(onRequest, context)
    }
})

