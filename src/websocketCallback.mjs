import { Node } from './node.mjs';
import { WebSocketServer } from 'ws';

/** @typedef {Object} WebSocketCallBack
 * @property {Function} fnc
 * @property {Object<string, WebSocket[]>} triggers
 * @property {boolean} active
 * @property {function(any, string | 'all'): void} execute
 * - arg0= data => To send to the clients.
 * - arg1= trigger - Key of the wsClients ~ ex: '11:ffee00:25'(anchor) default: 'all'
 */
/** 
 * @param {Function} fnc - example: send info to related clients
 * @param {Object<string, WebSocket[]>} triggers - example: trigger="11:ffee00:25"(anchor) -> when uxto is spent => send info to related clients
 */
export const WebSocketCallBack = (fnc, triggers, active = true) => {
    /** @type {WebSocketCallBack} */
    return {
        active,
        fnc,
        triggers,
        execute: (data, trigger = 'all') => {
            const wsClients = triggers[trigger];
            if (!wsClients) { console.error(`Trigger ${trigger} not found`); return; }
            fnc(data, wsClients);
        }
    }
}

export class CallBackManager {
    static CALLBACKS_RELATED_TO_MODE = { // HERE ARE THE GENERIC CALLBACKS - THOSE THAT SPEND EVENT TO ALL CLIENTS
        dashboard: {
            node: [ 'onBroadcastNewCandidate' ],
            miner: [ 'onBroadcastFinalizedBlock', 'onHashRateUpdated' ],
        },
        observer: {
            node: [ 'onBroadcastNewCandidate' ],
        },
    }

    /** 
     * @param {Node} node
     * @param {WebSocketServer} wss
     */
    constructor(node, wss) {
        /** @type {Node} */
        this.node = node;
        /** @type {WebSocketServer} */
        this.wss = wss;
    }

    /** @param { string[] | string } modes */
    initAllCallbacksOfMode(modes = ['dashboard']) {
        const modesArray = Array.isArray(modes) ? modes : [modes];
        /** @type {Object<string, string[]>} */
        const callBacksRelatedToMode = CallBackManager.buildCallBacksFunctionsListToSubscribe(modesArray);
        const targetModules = Object.keys(callBacksRelatedToMode);
        for (const module of targetModules) {
            for (const fncName of callBacksRelatedToMode[module]) {
                /** @type {Function} */
                const fnc = CALLBACKS_FUNCTIONS[module][fncName];
                if (!fnc) { console.error(`Function ${fncName} not found`); return; }

                const webSocketCallBack = WebSocketCallBack(fnc, {'all': this.wss.clients}, true);
                this.#attachWebSocketCallBackToModule(webSocketCallBack, fncName, module);
            };
        }
    }
    /** @param { WebSocketCallBack } webSocketCallBack */
    #attachWebSocketCallBackToModule(webSocketCallBack, fncName = 'onBroadcastNewCandidate', moduleName = 'node') {
        let targetModule;
        switch (moduleName) {
            case 'node':
                targetModule = this.node;
                break;
            case 'miner':
                targetModule = this.node.miner;
                break;
            case 'memPool':
                targetModule = this.node.memPool;
                break;
            default:
                break;
        }

        if (!targetModule) { console.error(`Module ${moduleName} not found`); return; }
        if (!targetModule.webSocketCallbacks) { console.error(`Module ${moduleName} has no webSocketCallbacks`); return; }

        targetModule.webSocketCallbacks[fncName] = webSocketCallBack;
    }
    /** @param { string[] | string } modes */
    static buildCallBacksFunctionsListToSubscribe(modes = ['dashboard']) {
        const modesArray = Array.isArray(modes) ? modes : [modes];
        const aggregatedCallBacksNames = {
            node: [],
            miner: [],
            memPool: []
        };

        for (const mode of modesArray) {
            const modulesToAttach = Object.keys(CallBackManager.CALLBACKS_RELATED_TO_MODE[mode]);

            for (const module of modulesToAttach) {
                const functionsNames = CallBackManager.CALLBACKS_RELATED_TO_MODE[mode][module];
                for (const fncName of functionsNames) {
                    if (!aggregatedCallBacksNames[module]) { aggregatedCallBacksNames[module] = []; }
                    if (!aggregatedCallBacksNames[module].includes(fncName)) { aggregatedCallBacksNames[module].push(fncName); }
                };
            };
        };

        return aggregatedCallBacksNames;
    }
}

/**
 * @param {any} message 
 * @param {WebSocket[]} wsClients
 */
function sendToAllClients(message, wsClients) {
    for (const client of wsClients) {
        if (client.readyState !== 1) { return; }
        client.send(JSON.stringify(message));
        //console.info(`[WS] ${message.type} sent to client: ${client.url}`);
    };
}

// HERE ARE THE CALLBACKS FUNCTIONS
// each function will be called when the related event is triggered
// developpers can change the "type" of the message to send to the client's websockets
const CALLBACKS_FUNCTIONS = {
    node: {
        /** send the finalized block when the local node confirmed it
         * @param {BlockData} finalizedBlock */
        onBroadcastNewCandidate: (finalizedBlock, wsClients = []) => {
            sendToAllClients({ type: 'broadcast_new_candidate', data: finalizedBlock }, wsClients);
        },
    },
    miner: {
        /** send the finalized block when local miner broadcast it
         * @param {BlockData} finalizedBlock */
        onBroadcastFinalizedBlock: (finalizedBlock, wsClients = []) => {
            sendToAllClients({ type: 'broadcast_finalized_block', data: finalizedBlock }, wsClients);
        },
        /** send the local miner hashRate to the clients */
        onHashRateUpdated: (hashRate = 0, wsClients = []) => {
            sendToAllClients({ type: 'hash_rate_updated', data: hashRate }, wsClients);
        },
    },
    memPool: {
        /** send info of tx inclusion when the memPool try to push a tx */
        pushTransaction: (txInfo = {}, wsClients = []) => {
            sendToAllClients({ type: 'transaction_broadcasted', data: txInfo }, wsClients);
        },
        /** send tx reference when the uxto is spent. tx ref: height:TxID - '0:ffffff' */
        uxtoSpent: (txReference = '0:ffffff', wsClients = []) => {
            sendToAllClients({ type: 'uxto_spent', data: txReference }, wsClients);
        },
    }
}