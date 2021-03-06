/**
 * @author:    Partner
 * @license:   UNLICENSED
 *
 * @copyright: Copyright (c) 2017 by Index Exchange. All rights reserved.
 *
 * The information contained within this document is confidential, copyrighted
 * and or a trade secret. No part of this document may be reproduced or
 * distributed in any form or by any means, in whole or in part, without the
 * prior written permission of Index Exchange.
 */

'use strict';

////////////////////////////////////////////////////////////////////////////////
// Dependencies ////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

var Browser = require('browser.js');
var Classify = require('classify.js');
var Constants = require('constants.js');
var Partner = require('partner.js');
var Size = require('size.js');
var SpaceCamp = require('space-camp.js');
var System = require('system.js');
var Network = require('network.js');
var Utilities = require('utilities.js');

var ComplianceService;
var RenderService;

//? if (DEBUG) {
var ConfigValidators = require('config-validators.js');
var PartnerSpecificValidator = require('pub-matic-htb-validator.js');
var Scribe = require('scribe.js');
var Whoopsie = require('whoopsie.js');
//? }

var undef;

////////////////////////////////////////////////////////////////////////////////
// Main ////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

/**
 * Partner module template
 *
 * @class
 */
function PubMaticHtb(configs) {
    /* =====================================
     * Data
     * ---------------------------------- */

    /* Private
     * ---------------------------------- */

    /**
     * Reference to the partner base class.
     *
     * @private {object}
     */
    var __baseClass;

    /**
     * Profile for this partner.
     *
     * @private {object}
     */
    var __profile;
    var __globalConfigs;

    /* =====================================
     * Functions
     * ---------------------------------- */

    /* Utilities
     * ---------------------------------- */

    function _parseSlotParam(paramName, paramValue) {
        if (Utilities.isString(paramValue)) {
            switch (paramName) {
                case 'pmzoneid':

                    return paramValue.split(',')
                        .slice(0, 50)
                        .map(function (id) {
                            return id.trim();
                        })
                        .join();
                case 'kadfloor':
                case 'lat':
                case 'lon':

                    return parseFloat(paramValue) || undef;
                case 'yob':
                    return parseInt(paramValue, 10) || undef;

                default:

                    return paramValue;
            }
        } else {
            return undef;
        }
    }

    function __populateImprObject(returnParcels) {
        var retArr = [];
        var impObj = {};
        var sizes = [];
        var sizeIndex = 0;

        returnParcels.forEach(function (rp) {
            sizeIndex = 0;
            impObj = {
                id: rp.htSlot.getId(),
                tagId: rp.xSlotRef.adUnitName,
                secure: 1,
                bidFloor: _parseSlotParam('kadfloor', __globalConfigs.kadfloor),
                ext: {
                    pmZoneId: _parseSlotParam('pmzoneid', rp.pmzoneid)
                }
            };
            sizes = rp.xSlotRef.sizes;
            impObj.banner = {};
            impObj.banner.format = [];
            sizes.forEach(function (size) {
                if (size.length === 2) {
                    if (sizeIndex === 0) {
                        impObj.banner.w = size[0];
                        impObj.banner.h = size[1];
                        sizeIndex++;
                    } else {
                        impObj.banner.format.push(
                            {
                                w: size[0],
                                h: size[1]
                            }
                        );
                    }
                }
            });
            if (impObj.banner.format.length === 0) {
                delete impObj.banner.format;
            }
            retArr.push(impObj);
        });

        return retArr;
    }

    function __populateSiteObject(publisherId) {
        var retObj = {
            page: Browser.topWindow.location.href,
            ref: Browser.topWindow.document.referrer,
            publisher: {
                id: publisherId,
                domain: Browser.topWindow.location.hostname
            },
            domain: Browser.topWindow.location.hostname
        };

        return retObj;
    }

    function __populateDeviceInfo() {
        var dnt = Browser.topWindow.navigator.doNotTrack === 'yes'
                    || Browser.topWindow.navigator.doNotTrack === '1'
                    || Browser.topWindow.navigator.msDoNotTrack === '1' ? 1 : 0;

        return {
            ua: Browser.getUserAgent(),
            js: 1,
            dnt: dnt,
            h: Browser.getScreenHeight(),
            w: Browser.getScreenWidth(),
            language: Browser.getLanguage(),
            geo: {
                lat: _parseSlotParam('lat', __globalConfigs.lat),
                lon: _parseSlotParam('lon', __globalConfigs.lon)
            }
        };
    }

    function __populateUserInfo(rp, idData) {
        var userObj = {
            gender: __globalConfigs.gender ? __globalConfigs.gender.trim() : undef,
            geo: {
                lat: _parseSlotParam('lat', __globalConfigs.lat),
                lon: _parseSlotParam('lon', __globalConfigs.lon)
            },
            yob: _parseSlotParam('yob', __globalConfigs.yob)
        };

        if (idData && idData.hasOwnProperty('AdserverOrgIp') && idData.AdserverOrgIp.hasOwnProperty('data')) {
            userObj.eids = [idData.AdserverOrgIp.data];
        }

        return userObj;
    }

    function __populateExtObject() {
        var ext = {};
        ext.wrapper = {};
        ext.wrapper.wiid = __globalConfigs.wiid || undef;
        ext.wrapper.transactionId = __globalConfigs.transactionId;
        ext.wrapper.wp = 'ixjs';

        return ext;
    }

    /**
     * Generates the request URL and query data to the endpoint for the xSlots
     * in the given returnParcels.
     *
     * @param  {object[]} returnParcels
     *
     * @return {object}
     */

    function __generateRequestObj(returnParcels) {
        /* =============================================================================
         * STEP 2  | Generate Request URL
         * -----------------------------------------------------------------------------
         *
         * Generate the URL to request demand from the partner endpoint using the provided
         * returnParcels. The returnParcels is an array of objects each object containing
         * an .xSlotRef which is a reference to the xSlot object from the partner configuration.
         * Use this to retrieve the placements/xSlots you need to request for.
         *
         * If your partner is MRA, returnParcels will be an array of length one. If your
         * partner is SRA, it will contain any number of entities. In any event, the full
         * contents of the array should be able to fit into a single request and the
         * return value of this function should similarly represent a single request to the
         * endpoint.
         *
         * Return an object containing:
         * queryUrl: the url for the request
         * data: the query object containing a map of the query string paramaters
         *
         * callbackId:
         *
         * arbitrary id to match the request with the response in the callback function. If
         * your endpoint supports passing in an arbitrary ID and returning it as part of the response
         * please use the callbackType: Partner.CallbackTypes.ID and fill out the adResponseCallback.
         * Also please provide this adResponseCallback to your bid request here so that the JSONP
         * response calls it once it has completed.
         *
         * If your endpoint does not support passing in an ID, simply use
         * Partner.CallbackTypes.CALLBACK_NAME and the wrapper will take care of handling request
         * matching by generating unique callbacks for each request using the callbackId.
         *
         * If your endpoint is ajax only, please set the appropriate values in your profile for this,
         * i.e. Partner.CallbackTypes.NONE and Partner.Requesttypes.AJAX. You also do not need to provide
         * a callbackId in this case because there is no callback.
         *
         * The return object should look something like this:
         * {
         *     url: 'http://bidserver.com/api/bids' // base request url for a GET/POST request
         *     data: { // query string object that will be attached to the base url
         *        slots: [
         *             {
         *                 placementId: 54321,
         *                 sizes: [[300, 250]]
         *             },{
         *                 placementId: 12345,
         *                 sizes: [[300, 600]]
         *             },{
         *                 placementId: 654321,
         *                 sizes: [[728, 90]]
         *             }
         *         ],
         *         site: 'http://google.com'
         *     },
         *     callbackId: '_23sd2ij4i1' //unique id used for pairing requests and responses
         * }
         */

        var idData = returnParcels[0] && returnParcels[0].identityData;

        /* ---------------------- PUT CODE HERE ------------------------------------ */
        var payload = {};
        var callbackId = System.generateUniqueId();
        var baseUrl = 'https://hbopenbid.pubmatic.com/translator?source=index-client';
        payload = {
            // Str | mandatory
            id: String(new Date()
                .getTime()),

            // Int | mandatory
            at: 1,

            // [str] | opt
            cur: ['USD'],

            // Obj | mandatory - pending
            imp: __populateImprObject(returnParcels),

            // Obj | opt
            site: __populateSiteObject(__globalConfigs.pubId),

            // Obj | mandatory
            device: __populateDeviceInfo(),

            // Obj | opt
            user: __populateUserInfo(returnParcels[0], idData),
            ext: __populateExtObject()
        };

        /* ------------------------ Get consent information -------------------------
         * If you want to implement GDPR consent in your adapter, use the function
         * ComplianceService.gdpr.getConsent() which will return an object.
         *
         * Here is what the values in that object mean:
         *      - applies: the boolean value indicating if the request is subject to
         *      GDPR regulations
         *      - consentString: the consent string developed by GDPR Consent Working
         *      Group under the auspices of IAB Europe
         *
         * The return object should look something like this:
         * {
         *      applies: true,
         *      consentString: 'BOQ7WlgOQ7WlgABABwAAABJOACgACAAQABA'
         * }
         */
        var isPrivacyEnabled = ComplianceService.isPrivacyEnabled();
        if (isPrivacyEnabled) {
            var gdprStatus = ComplianceService.gdpr.getConsent();
            payload.user.ext = {
                consent: gdprStatus.consentString
            };
            payload.regs = {
                ext: {
                    gdpr: gdprStatus.applies ? 1 : 0
                }
            };
        }

        /* -------------------------------------------------------------------------- */

        return {
            url: baseUrl,
            data: payload,
            callbackId: callbackId,
            networkParamOverrides: {
                method: 'POST',
                contentType: 'text/plain'
            }
        };
    }

    /* =============================================================================
     * STEP 3  | Response callback
     * -----------------------------------------------------------------------------
     *
     * This generator is only necessary if the partner's endpoint has the ability
     * to return an arbitrary ID that is sent to it. It should retrieve that ID from
     * the response and save the response to adResponseStore keyed by that ID.
     *
     * If the endpoint does not have an appropriate field for this, set the profile's
     * callback type to CallbackTypes.CALLBACK_NAME and omit this function.
     */
    function adResponseCallback(adResponse) {
        /* Get callbackId from adResponse here */
        var callbackId = 0;
        __baseClass._adResponseStore[callbackId] = adResponse;
    }

    /* -------------------------------------------------------------------------- */

    /* Helpers
     * ---------------------------------- */

    /* =============================================================================
     * STEP 5  | Rendering Pixel
     * -----------------------------------------------------------------------------
     *
    */

    /**
     * This function will render the pixel given.
     * @param  {string} pixelUrl Tracking pixel img url.
     */
    function __renderPixel(pixelUrl) {
        if (pixelUrl) {
            Network.img({
                url: decodeURIComponent(pixelUrl),
                method: 'GET'
            });
        }
    }

    /**
     * Parses and extracts demand from adResponse according to the adapter and then attaches it
     * to the corresponding bid's returnParcel in the correct format using targeting keys.
     *
     * @param {string} sessionId The sessionId, used for stats and other events.
     *
     * @param {any} adResponse This is the bid response as returned from the bid request, that was either
     * passed to a JSONP callback or simply sent back via AJAX.
     *
     * @param {object[]} returnParcels The array of original parcels, SAME array that was passed to
     * generateRequestObj to signal which slots need demand. In this funciton, the demand needs to be
     * attached to each one of the objects for which the demand was originally requested for.
     */
    function __parseResponse(sessionId, adResponse, returnParcels) {
        /* =============================================================================
         * STEP 4  | Parse & store demand response
         * -----------------------------------------------------------------------------
         *
         * Fill the below variables with information about the bid from the partner, using
         * the adResponse variable that contains your module adResponse.
         */

        /* This an array of all the bids in your response that will be iterated over below. Each of
         * these will be mapped back to a returnParcel object using some criteria explained below.
         * The following variables will also be parsed and attached to that returnParcel object as
         * returned demand.
         *
         * Use the adResponse variable to extract your bid information and insert it into the
         * bids array. Each element in the bids array should represent a single bid and should
         * match up to a single element from the returnParcel array.
         *
         */

        /* ---------- Process adResponse and extract the bids into the bids array ------------ */

        var bids = [];
        if (adResponse && adResponse.seatbid && Utilities.isArray(adResponse.seatbid)
          && adResponse.seatbid.length > 0) {
            for (var ii = 0; ii < adResponse.seatbid.length; ii++) {
                bids = bids.concat(adResponse.seatbid[ii].bid);
            }
        }

        /* --------------------------------------------------------------------------------- */

        for (var j = 0; j < returnParcels.length; j++) {
            var curReturnParcel = returnParcels[j];

            var headerStatsInfo = {};
            var htSlotId = curReturnParcel.htSlot.getId();
            headerStatsInfo[htSlotId] = {};
            headerStatsInfo[htSlotId][curReturnParcel.requestId] = [curReturnParcel.xSlotName];

            var curBid;
            var sizes;
            var curReturnParcelLen = curReturnParcel.xSlotRef.sizes.length;
            var bidMatchFound = false;

            if (!bids
              || !Utilities.isArray(bids)
              || bids.length === 0
            ) {
                if (__profile.enabledAnalytics.requestTime) {
                    __baseClass._emitStatsEvent(sessionId, 'hs_slot_pass', headerStatsInfo);
                }
                curReturnParcel.pass = true;

                continue;
            }

            for (var i = 0; i < bids.length; i++) {
                bidMatchFound = false;
                for (var index = 0; index < curReturnParcelLen; index++) {
                    sizes = curReturnParcel.xSlotRef.sizes[index];

                    /**
                     * This section maps internal returnParcels and demand returned from the bid request.
                     * In order to match them correctly, they must be matched via some criteria. This
                     * is usually some sort of placements or inventory codes. Please replace the someCriteria
                     * key to a key that represents the placement in the configuration and in the bid responses.
                    */
                    if (bids[i].impid === curReturnParcel.htSlot.getId()) {
                        if (parseInt(bids[i].w, 10) === parseInt(sizes[0], 10)
                            && parseInt(bids[i].h, 10) === parseInt(sizes[1], 10)) {
                            curBid = bids[i];
                            bids.splice(i, 1);
                            bidMatchFound = true;

                            break;
                        }
                    }
                }

                if (bidMatchFound) {
                    break;
                }
            }

            /* No matching bid found so its a pass */
            if (!curBid) {
                if (__profile.enabledAnalytics.requestTime) {
                    __baseClass._emitStatsEvent(sessionId, 'hs_slot_pass', headerStatsInfo);
                }
                curReturnParcel.pass = true;

                continue;
            }

            /* ---------- Fill the bid variables with data from the bid response here. ------------ */

            /* Using the above variable, curBid, extract various information about the bid and assign it to
             * these local variables */

            /* The bid price for the given slot */
            var bidPrice = curBid.price;

            /* The size of the given slot */
            var bidSize = [Number(curBid.w), Number(curBid.h)];

            /* The creative/adm for the given slot that will be rendered if is the winner.
             * Please make sure the URL is decoded and ready to be document.written.
             */
            var bidCreative = curBid.adm;

            /* The dealId if applicable for this slot. */
            var bidDealId = curBid.dealid;

            /* Explicitly pass */
            var bidIsPass = bidPrice <= 0;

            /* OPTIONAL: tracking pixel url to be fired AFTER rendering a winning creative.
            * If firing a tracking pixel is not required or the pixel url is part of the adm,
            * leave empty;
            */
            var pixelUrl = '';

            /* --------------------------------------------------------------------------------------- */

            curBid = null;
            if (bidIsPass) {
                //? if (DEBUG) {
                Scribe.info(__profile.partnerId + ' returned pass for { id: ' + adResponse.id + ' }.');
                //? }
                if (__profile.enabledAnalytics.requestTime) {
                    __baseClass._emitStatsEvent(sessionId, 'hs_slot_pass', headerStatsInfo);
                }
                curReturnParcel.pass = true;

                continue;
            }

            if (__profile.enabledAnalytics.requestTime) {
                __baseClass._emitStatsEvent(sessionId, 'hs_slot_bid', headerStatsInfo);
            }

            curReturnParcel.size = bidSize;
            curReturnParcel.targetingType = 'slot';
            curReturnParcel.targeting = {};

            var targetingCpm = '';

            //? if (FEATURES.GPT_LINE_ITEMS) {
            targetingCpm = __baseClass._bidTransformers.targeting.apply(bidPrice);
            var sizeKey = Size.arrayToString(curReturnParcel.size);

            if (bidDealId) {
                curReturnParcel.targeting[__baseClass._configs.targetingKeys.pmid] = [sizeKey + '_' + bidDealId];
                curReturnParcel.targeting[__baseClass._configs.targetingKeys.pm] = [sizeKey + '_' + targetingCpm];
            } else {
                curReturnParcel.targeting[__baseClass._configs.targetingKeys.om] = [sizeKey + '_' + targetingCpm];
            }
            curReturnParcel.targeting[__baseClass._configs.targetingKeys.id] = [curReturnParcel.requestId];
            //? }

            //? if (FEATURES.RETURN_CREATIVE) {
            curReturnParcel.adm = bidCreative;
            if (pixelUrl) {
                curReturnParcel.winNotice = __renderPixel.bind(null, pixelUrl);
            }
            //? }

            //? if (FEATURES.RETURN_PRICE) {
            curReturnParcel.price = Number(__baseClass._bidTransformers.price.apply(bidPrice));
            //? }
            var demandExpiry = __profile.features.demandExpiry;

            var pubKitAdId = RenderService.registerAd({
                sessionId: sessionId,
                partnerId: __profile.partnerId,
                adm: bidCreative,
                requestId: curReturnParcel.requestId,
                size: curReturnParcel.size,
                price: targetingCpm,
                dealId: bidDealId || undef,
                timeOfExpiry: demandExpiry.enabled ? demandExpiry.value + System.now() : 0,
                auxFn: __renderPixel,
                auxArgs: [pixelUrl]
            });

            //? if (FEATURES.INTERNAL_RENDER) {
            curReturnParcel.targeting.pubKitAdId = pubKitAdId;
            //? }
        }
    }

    /* =====================================
     * Constructors
     * ---------------------------------- */

    (function __constructor() {
        RenderService = SpaceCamp.services.RenderService;
        ComplianceService = SpaceCamp.services.ComplianceService;

        /* =============================================================================
         * STEP 1  | Partner Configuration
         * -----------------------------------------------------------------------------
         *
         * Please fill out the below partner profile according to the steps in the README doc.
         */

        /* ---------- Please fill out this partner profile according to your module ------------ */
        __profile = {

            // PartnerName
            partnerId: 'PubmaticHtb',

            // Should be same as partnerName
            namespace: 'PubmaticHtb',

            // Unique partner identifier
            statsId: 'PUBM',
            version: '2.1.3',
            targetingType: 'slot',
            enabledAnalytics: {
                requestTime: !0
            },
            features: {
                demandExpiry: {
                    enabled: !1,
                    value: 0
                },
                rateLimiting: {
                    enabled: !1,
                    value: 0
                }
            },

            // Targeting keys for demand, should follow format ix_{statsId}_id
            targetingKeys: {
                id: 'ix_pubm_id',
                om: 'ix_pubm_om',
                pm: 'ix_pubm_om',
                pmid: 'ix_pubm_dealid'
            },

            // The bid price unit (in cents) the endpoint returns, please refer to the readme for details
            bidUnitInCents: 100,
            lineItemType: Constants.LineItemTypes.ID_AND_SIZE,

            // Callback type, please refer to the readme for details
            callbackType: Partner.CallbackTypes.NONE,

            // Request architecture, please refer to the readme for details
            architecture: Partner.Architectures.SRA,

            // Request type, jsonp, ajax, or any.
            requestType: Partner.RequestTypes.AJAX
        };

        /* --------------------------------------------------------------------------------------- */

        //? if (DEBUG) {
        var results = ConfigValidators.partnerBaseConfig(configs) || PartnerSpecificValidator(configs);

        if (results) {
            throw Whoopsie('INVALID_CONFIG', results);
        }
        //? }
        __globalConfigs = {
            pubId: configs.publisherId,

            /* Pubmatic specific values. required in the api request */
            lat: configs.lat || undef,
            lon: configs.lon || undef,
            yob: configs.yob || undef,
            gender: configs.gender || undef,
            kadfloor: configs.kadfloor || undef,
            profile: configs.profile || undef,
            version: configs.version || undef
        };
        __baseClass = Partner(__profile, configs, null, {
            parseResponse: __parseResponse,
            generateRequestObj: __generateRequestObj,
            adResponseCallback: adResponseCallback
        });
    })();

    /* =====================================
     * Public Interface
     * ---------------------------------- */

    var derivedClass = {
        /* Class Information
         * ---------------------------------- */

        //? if (DEBUG) {
        __type__: 'PubMaticHtb',
        //? }

        //? if (TEST) {
        __baseClass: __baseClass,
        //? }

        /* Data
         * ---------------------------------- */

        //? if (TEST) {
        profile: __profile,
        //? }

        /* Functions
         * ---------------------------------- */

        //? if (TEST) {
        parseResponse: __parseResponse,
        generateRequestObj: __generateRequestObj,
        adResponseCallback: adResponseCallback
        //? }
    };

    return Classify.derive(__baseClass, derivedClass);
}

////////////////////////////////////////////////////////////////////////////////
// Exports /////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

module.exports = PubMaticHtb;
