/**
 * @NApiVersion 2.1
 */
define(['N/https','N/log'],

    (https, log) => {
        /*
        API:
        https://www.printnode.com/en/docs/api/curl#printjob-creating
         */
        const API_KEY = 'PY8UQyEeCoPrxtcZSWW6G-ZCC6PoOhbfaaaAzev_PPw';
        // as this would be call in backend too, get below by 'Basic ' + btoa(API_KEY + ':')
        const API_KEY_BTOA = 'Basic UFk4VVF5RWVDb1ByeHRjWlNXVzZHLVpDQzZQb09oYmZhYWFBemV2X1BQdzo='
        const API_URL = 'https://api.printnode.com/printjobs';
        const REPORT_TYPE = {
            'PACKING_SLIP': 'Packing Slip',
            'BILL_OF_LADING': 'Bill of Lading',
            'UCC_LABEL': 'UCC Label',
            'FEDEX_LABEL': 'FedEx Label'
        };
        const PRINTER = {
            SHARP_MX_5070_2: '74452670',
            UPS_WORLDSHIP: '74452668',
            UPS_SMALLPARCELWH2:'74452677'
        }

        function getPrinterByReportType(reportType) {
            if (reportType === REPORT_TYPE.PACKING_SLIP || reportType === REPORT_TYPE.BILL_OF_LADING ) {
                return PRINTER.SHARP_MX_5070_2;
            } else if (reportType === REPORT_TYPE.UCC_LABEL) {
                return PRINTER.UPS_WORLDSHIP;
            } else if (reportType === REPORT_TYPE.FEDEX_LABEL) {
                return PRINTER.UPS_SMALLPARCELWH2; // FedEx labels routed to small parcel printer
            } else {
                throw new Error('Invalid report type: ' + reportType);
            }
        }

    function printByPrintNode(title, content, reportType, qty =1) {
            if (typeof console !== 'undefined' && console.log) {
                console.log('Call to Print Node', title, content, reportType, qty);
            }
            const payload = {
                printerId: getPrinterByReportType(reportType),
                title: title,
                contentType: reportType === REPORT_TYPE.FEDEX_LABEL ? 'raw_uri' : 'pdf_uri' ,
                content: content,
                qty: 1
            };

            const headers = {
                'Authorization': API_KEY_BTOA,
                'Content-Type': 'application/json'
            };

            const response = https.post({
                url: API_URL,
                body: JSON.stringify(payload),
                headers: headers
            });
            //if console.log is available, log the response
            if (typeof console !== 'undefined' && console.log) {
                console.log('Print Node Response', response);
            }

            if (response.code === 201) {
                var successBody = {};
                try { successBody = JSON.parse(response.body); } catch(e) {}
                if (typeof console !== 'undefined' && console.log) {
                    console.log('Print Node Response', successBody);
                }
                try { log.debug({ title: 'PrintNode Success', details: successBody }); } catch(e) {}
                return successBody;
            } else {
                if (typeof console !== 'undefined' && console.log) {
                    console.log('Error From Print Node', response.body);
                }
                try { log.error({ title: 'PrintNode Error', details: response.body }); } catch(e) {}
                throw new Error('Failed to create print job: ' + response.body);
            }
        }
        return {printByPrintNode, REPORT_TYPE}

    });
