/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/record', 'N/render', 'N/file', 'N/log','./Con_Lib_PackShip_Lib'], function (search, record, render, file, log, packShipLib) {

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
        }
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
                const fullAddress = so.getValue('shipaddress');

                // Totals & SSCC aggregation
                const customerId = so.getValue('entity');
                const totals = packShipLib.computeShipmentTotals(salesOrderId, customerId);
                const { codes: ssccList } = packShipLib.getAllSSCCBySalesOrder(salesOrderId);
                const ssccRaw = ssccList.join(',');
                // Build ship unit counts: if SSCC exists enumerate globally; else per-line pallet counts
                let shipUnitCountStrings = [];
                if (ssccList.length) {
                    shipUnitCountStrings = ssccList.map((_,i)=>`${i+1} OF ${ssccList.length}`);
                } else {
                    (totals.lines||[]).forEach(l => {
                        const pal = Number(l.linePalletQty)||0;
                        if (pal>0) for (let i=1;i<=pal;i++) shipUnitCountStrings.push(`${i} OF ${pal}`);
                    });
                    if (!shipUnitCountStrings.length) shipUnitCountStrings = ['1 OF 1'];
                }
                const salesOrder = {
                    tranId: so.getValue('tranid'),
                    id: salesOrderId,
                    marketId: "",
                    customerOrderNumber: so.getValue('custbody_customer_order_number'),
                    companyName: shippingAddress.name,
                    shipAddress: shippingAddress.address,
                    shipAddress2: shippingAddress.address2,
                    fullAddress: fullAddress.replaceAll('\n', '<br/>'),
                    poNumber: so.getValue('otherrefnum'),
                    sscc: ssccList[0] || ssccRaw || '',
                    ssccList: ssccList || [],
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
            pdfFile.name = `HomeDepot_${salesOrder.tranId || salesOrder.id}.pdf`;

            return pdfFile;

        } catch (error) {
            log.error('Error generating PDF', error.toString());
            throw error;
        }
    }

    function createHtmlTemplate(templateData, repeating = 1) {
        const codes = (templateData.ssccList && templateData.ssccList.length) ? templateData.ssccList : [ templateData.sscc ];
        const shipUnits = templateData.shipUnitCountStrings || [];
        const pdfString = codes.map((code, idx) => {
            const unitStr = shipUnits[idx] || '';
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
        
        .customer-address td {
            border: 0;
        }
        
        .barcode {
            height: 30pt;
        }
        
        .barcode-large {
            height: 40pt;
        }
        
        .address-row {
            height: 1.5in;
        }
        
        .customer-row {
            height: 1.9in;
        }
        
        .sscc-row {
            height: 2.3in;
        }
        .formatting-table td{
            font-size: 14px;
            border: none;
        }
    </style>
</head>

<body size="4in x 6in" margin="0.1in">
    <!-- Header Section with FROM/TO -->
    <table class="header-table">
        <tr class="address-row">
            <td style="border-bottom: 0;font-size: 16px;" align="center">
                <p align="center" style="padding-top: 16px;">Water Creation<br/>
                701 Auto Center Dr, Ontario, CA 91761<br/>
                (909) 773-1777<br/><br/>
                PO # ${templateData.poNumber}<br/>
                SO # ${templateData.tranId}
                </p>
            </td>
        </tr>
    </table>
    
    <!-- ZIP Code and Carrier Section -->
    <table class="info-table">
        <tr class="customer-row">
            <td style="border-bottom: 0;">
                <table class="formatting-table" style=" font-size: 12px; line-height: 16px;">
                    <tbody>
                        <tr><td colspan="2">MARKET ID: ${templateData.marketId}<br/></td></tr>
                        <tr><td colspan="2">CUSTOMER ORDER #: ${templateData.customerOrderNumber}<br/></td></tr>
                        <tr><td width="25%">CUSTOMER:</td><td width="75%">${templateData.fullAddress}</td></tr>
                    </tbody>
                </table>
                <!--<table class="customer-address">
                    <tr>
                        <td>${templateData.companyName}</td>
                    </tr>
                    <tr>
                        <td>${templateData.shipAddress}</td>
                    </tr>
                    <tr>
                        <td>${templateData.shipAddress2}</td>
                    </tr>
                </table>-->
            </td>
        </tr>
    </table>
    
    <!-- FOR Section with Item Barcode -->
    <table class="info-table">
        <tr class="sscc-row">
            <td colspan="2" align="center">
                <p style="font-size: 16px; padding-top:20px;">SSCC: ${code}</p>
                <!--${ unitStr ? `<p style="font-size:12px;">${unitStr}</p>` : '' }-->
                <div class="barcode-cell" style="margin: 0 auto;">
                    <barcode codetype="code128" showtext="false" width="100%" value="${code}" class="barcode-large"/>
                </div>
                <p style="font-size: 16px;">(00) ${code}</p>
            </td>
        </tr>
    </table>
</body>
 </pdf>`; }).join('');
        return `<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd"><pdfset>${pdfString}</pdfset>`
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

