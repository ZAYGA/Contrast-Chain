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
            const wsClients = triggers.all ? triggers.all : triggers[trigger];
            if (!wsClients) { console.error(`No clients found for trigger: ${trigger}`); return; }
            if (wsClients.length === 0) { return; }

            fnc(data, wsClients, trigger);
        }
    }
}

export class CallBackManager {
    #CALLBACKS_RELATED_TO_MODE;

    /** @param {Node} node */
    constructor(node) {
        /** @type {Node} */
        this.node = node;
        
        this.#CALLBACKS_RELATED_TO_MODE = { // HERE ARE THE GENERIC CALLBACKS - THOSE THAT SPEND EVENT TO ALL CLIENTS
            validatorDashboard: {
                node: ['onBroadcastNewCandidate:all'],
                memPool: ['pushTransaction:all', 'uxtoSpent:all'],
                utxoCache: [`onBalanceUpdated:${this.node.account.address}`],
            },
            minerDashboard: {
                miner: ['onBroadcastFinalizedBlock:all', 'onHashRateUpdated:all'],
                utxoCache: [`onBalanceUpdated:${this.node.miner.address}`],
            },
            observer: {
                node: ['onBroadcastNewCandidate:all'],
            },
        }
    }
    /** 
     * @param { string[] | string } modes - 'validatorDashboard' | 'minerDashboard' | 'observer'
     * @param {WebSocket[]} wsClients - clients to send the message (wss.clients for all)
     */
    initAllCallbacksOfMode(modes, wsClients) {
        const modesArray = Array.isArray(modes) ? modes : [modes];
        /** @type {Object<string, string[]>} */
        const callBacksRelatedToMode = this.#buildCallBacksFunctionsListToSubscribe(modesArray);
        const targetModules = Object.keys(callBacksRelatedToMode);
        for (const module of targetModules) {
            for (const fncKey of callBacksRelatedToMode[module]) {
                this.attachWsCallBackToModule(module, fncKey, wsClients); // we attach the callback to all clients
            };
        }
    }
    /** 
     * @param {string} moduleName - 'node' | 'miner' | 'memPool' | 'utxoCache'
     * @param {string} fncKey -  "fncName:trigger"  ex: 'balance_updated:W9bxy4aLJiQjX1kNgoAC'
     * @param {WebSocket[]} wsClients - clients to send the message
     */
    attachWsCallBackToModule(moduleName, fncKey, wsClients) {
        let targetModule;
        switch (moduleName) {
            case 'node':
                targetModule = this.node;
                break;
            default:
                targetModule = this.node[moduleName];
                break;
        }
        if (!targetModule) { console.error(`Module ${moduleName} not found`); return; }
        if (!targetModule.wsCallbacks) { console.error(`Module ${moduleName} has no wsCallbacks`); return; }

        const fncName = fncKey.split(':')[0];
        const trigger = fncKey.split(':')[1] || 'all';
        /** @type {Function} */
        const fnc = CALLBACKS_FUNCTIONS[moduleName][fncName];
        if (!fnc) { console.error(`Function ${fncName} not found`); return; }

        if (!targetModule.wsCallbacks[fncName]) {
            // if the function is not already attached, we create it
            targetModule.wsCallbacks[fncName] = WebSocketCallBack(fnc, {[trigger]: wsClients}, true);
        } else {
            // if the function is already attached, we add the trigger
            targetModule.wsCallbacks[fncName].triggers[trigger] = wsClients;
        }
    }
    /** @param { string[] | string } modes */
    #buildCallBacksFunctionsListToSubscribe(modes = ['dashboard']) {
        const modesArray = Array.isArray(modes) ? modes : [modes];
        const aggregatedCallBacksNames = {
            node: [],
            miner: [],
            memPool: []
        };

        for (const mode of modesArray) {
            const modulesToAttach = Object.keys(this.#CALLBACKS_RELATED_TO_MODE[mode]);

            for (const module of modulesToAttach) {
                const functionsNames = this.#CALLBACKS_RELATED_TO_MODE[mode][module];
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
function sendToClients(message, wsClients) {
    for (const client of wsClients) {
        if (client.readyState !== 1) { continue; }
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
         * @param {BlockData} blockCandidate
         * @param {WebSocket[]} wsClients
         * @emits msgSent: { type: 'broadcast_new_candidate', data: blockCandidate, trigger }
         */
        onBroadcastNewCandidate: (blockCandidate, wsClients = [], trigger = '') => {
            sendToClients({ type: 'broadcast_new_candidate', data: blockCandidate, trigger }, wsClients);
        },
    },
    miner: {
        /** send the finalized block when local miner broadcast it
         * @param {BlockData} finalizedBlock
         * @param {WebSocket[]} wsClients
         * @emits msgSent: { type: 'broadcast_finalized_block', data: finalizedBlock, trigger }
        */
        onBroadcastFinalizedBlock: (finalizedBlock, wsClients = [], trigger = '') => {
            sendToClients({ type: 'broadcast_finalized_block', data: finalizedBlock, trigger }, wsClients);
        },
        /** send the local miner hashRate to the clients
         * @param {number} hashRate - hash rate of the miner
         * @param {WebSocket[]} wsClients
         * @emits msgSent: { type: 'hash_rate_updated', data: hashRate, trigger }
        */
        onHashRateUpdated: (hashRate = 0, wsClients = [], trigger = '') => {
            sendToClients({ type: 'hash_rate_updated', data: hashRate, trigger }, wsClients);
        },
    },
    memPool: {
        /** send info of tx inclusion when the memPool try to push a tx
         * @param {Object} txInfo - { broadcasted, pushedInLocalMempool, error }
         * @param {WebSocket[]} wsClients
         * @emits msgSent: { type: 'transaction_broadcasted', data: txInfo, trigger }
        */
        pushTransaction: (txInfo = {}, wsClients = [], trigger = '') => {
            sendToClients({ type: 'transaction_broadcasted', data: txInfo, trigger }, wsClients);
        },
        /** send tx reference when the uxto is spent.
         * @param {string} txReference tx ref: height:TxID - '0:ffffff'
         * @param {WebSocket[]} wsClients
         * @emits msgSent: { type: 'uxto_spent', data: txReference, trigger }
        */
        uxtoSpent: (txReference = '0:ffffff', wsClients = [], trigger = '') => {
            sendToClients({ type: 'uxto_spent', data: txReference, trigger }, wsClients);
        },
    },
    utxoCache: {
        /** send the updated balance of the related account when the balance is updated */
        onBalanceUpdated: (balance = 0, wsClients = [], trigger = '') => {
            sendToClients({ type: 'balance_updated', data: balance, trigger }, wsClients);
        },
    },
}