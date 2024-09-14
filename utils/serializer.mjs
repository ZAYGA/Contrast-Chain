import utils from "../src/utils.mjs";
import msgpack from '../externalLibs/msgpack.min.js';

const serializer = {
    rawData: {
        toBinary_v1(rawData) {
            return msgpack.encode(rawData);
        },
        fromBinary_v1(encodedData) {
            return msgpack.decode(encodedData);
        },
        clone(data) { // not that fast compared to JSON.parse(JSON.stringify(data))
            const encoded = serializer.rawData.toBinary_v1(data);
            const decoded = serializer.rawData.fromBinary_v1(encoded);
            return decoded;
        }
    },
    transaction: {
        /** @param {Transaction} tx */
        toBinary_v2(tx) { // return array of Uint8Array
            try {
                const txAsArray = [
                    null, // id
                    [], // witnesses
                    null, // version
                    [], // inputs,
                    [] // outputs
                ]

                txAsArray[0] = utils.convert.hex.toUint8Array(tx.id); // safe type: hex
                txAsArray[2] = utils.convert.number.toUint8Array(tx.version); // safe type: number

                for (let i = 0; i < tx.witnesses.length; i++) {
                    const splitted = tx.witnesses[i].split(':');
                    txAsArray[1].push([
                        utils.convert.hex.toUint8Array(splitted[0]), // safe type: hex
                        utils.convert.hex.toUint8Array(splitted[1]) // safe type: hex
                    ]);
                }

                for (let j = 0; j < tx.inputs.length; j++) {
                    const splitted = tx.inputs[j].split(':');
                    if (splitted.length === 3) { // -> anchor ex: "3:f996a9d1:0"
                        txAsArray[3].push([
                            utils.convert.number.toUint8Array(splitted[0]), // safe type: number
                            utils.convert.hex.toUint8Array(splitted[1]), // safe type: hex
                            utils.convert.number.toUint8Array(splitted[2]) // safe type: number
                        ]);
                    } else if (splitted.length === 2) { // -> pos validator address:hash
                        // ex: "WKXmNF5xJTd58aWpo7QX:964baf99b331fe400ca2de4da6fb4f52cbff8a7abfcea74e9f28704dc0dd2b5c"
                        txAsArray[3].push([
                            utils.convert.base58.toUint8Array(splitted[0]), // safe type: base58
                            utils.convert.hex.toUint8Array(splitted[1]) // safe type: hex
                        ]);
                    } else if (splitted.length === 1) { // -> pow miner nonce ex: "5684e9b4"
                        txAsArray[3].push([utils.convert.hex.toUint8Array(splitted[0])]); // safe type: hex
                    }
                };

                for (let j = 0; j < tx.outputs.length; j++) {
                    const { amount, rule, address } = tx.outputs[j];
                    if (amount, rule, address) { //  {"amount": 19545485, "rule": "sig", "address": "WKXmNF5xJTd58aWpo7QX"}
                        const ruleCode = UTXO_RULES_GLOSSARY[rule].code;
                        txAsArray[4].push([
                            utils.convert.number.toUint8Array(amount), // safe type: number
                            utils.convert.number.toUint8Array(ruleCode), // safe type: numbers
                            utils.convert.base58.toUint8Array(address) // safe type: base58
                        ]);
                    } else { // type: string
                        txAsArray[4].push([utils.convert.string.toUint8Array(tx.outputs[j])]);
                    }
                };
                /** @type {Uint8Array} */
                const encoded = msgpack.encode(txAsArray);
                return encoded;
            } catch (error) {
                console.error('Error in prepareTransaction.toBinary_v2:', error);
                throw new Error('Failed to serialize the transaction');
            }
        },
        /** @param {Uint8Array} encodedTx */
        fromBinary_v2(encodedTx) {
            try {
                /** @type {Transaction} */
                const decodedTx = msgpack.decode(encodedTx);
                /** @type {Transaction} */
                const tx = {
                    id: utils.convert.uint8Array.toHex(decodedTx[0]), // safe type: uint8 -> hex
                    witnesses: [],
                    version: utils.convert.uint8Array.toNumber(decodedTx[2]), // safe type: uint8 -> number
                    inputs: [],
                    outputs: []
                };

                for (let i = 0; i < decodedTx[1].length; i++) {
                    const signature = utils.convert.uint8Array.toHex(decodedTx[1][i][0]); // safe type: uint8 -> hex
                    const publicKey = utils.convert.uint8Array.toHex(decodedTx[1][i][1]); // safe type: uint8 -> hex
                    tx.witnesses.push(`${signature}:${publicKey}`);
                };

                for (let j = 0; j < decodedTx[3].length; j++) {
                    const input = decodedTx[3][j];
                    if (input.length === 3) { // -> anchor ex: "3:f996a9d1:0"
                        tx.inputs.push(`${utils.convert.uint8Array.toNumber(input[0])}:${utils.convert.uint8Array.toHex(input[1])}:${utils.convert.uint8Array.toNumber(input[2])}`);
                    } else if (input.length === 2) { // -> pos validator address:hash
                        tx.inputs.push(`${utils.convert.uint8Array.toBase58(input[0])}:${utils.convert.uint8Array.toHex(input[1])}`);
                    } else if (input.length === 1) { // -> pow miner nonce ex: "5684e9b4"
                        tx.inputs.push(utils.convert.uint8Array.toHex(input[0]));
                    }
                };

                for (let j = 0; j < decodedTx[4].length; j++) {
                    const output = decodedTx[4][j];
                    if (output.length === 3) {
                        const amount = utils.convert.uint8Array.toNumber(output[0]); // safe type: uint8 -> number
                        const ruleCode = utils.convert.uint8Array.toNumber(output[1]); // safe type: uint8 -> number
                        const rule = UTXO_RULESNAME_FROM_CODE[ruleCode];
                        const address = utils.convert.uint8Array.toBase58(output[2]); // safe type: uint8 -> base58
                        tx.outputs.push({ amount, rule, address });
                    } else {
                        tx.outputs.push(utils.convert.uint8Array.toString(output));
                    }
                }

                return tx;
            } catch (error) {
                console.error('Error in prepareTransaction.fromBinary_v2:', error);
                throw new Error('Failed to deserialize the transaction');
            }
        }
    },
    block_candidate: {
        /** @param {BlockData} blockData */
        toBinary_v2(blockData) {
            // + powReward
            // - nonce - hash - timestamp

            const blockAsArray = [
                utils.convert.number.toUint8Array(blockData.index), // safe type: number
                utils.convert.number.toUint8Array(blockData.supply), // safe type: number
                utils.convert.number.toUint8Array(blockData.coinBase), // safe type: number
                utils.convert.number.toUint8Array(blockData.difficulty), // safe type: number
                utils.convert.number.toUint8Array(blockData.legitimacy), // safe type: number
                utils.convert.hex.toUint8Array(blockData.prevHash), // safe type: hex
                utils.convert.number.toUint8Array(blockData.posTimestamp), // safe type: number
                utils.convert.number.toUint8Array(blockData.powReward), // safe type: number
                [] // Txs
            ];

            for (let i = 0; i < blockData.Txs.length; i++) {
                blockAsArray[8].push(serializer.transaction.toBinary_v2(blockData.Txs[i]));
            }

            /** @type {Uint8Array} */
            const encoded = msgpack.encode(blockAsArray);
            return encoded;
        },
        /** @param {Uint8Array} encodedBlock */
        fromBinary_v2(encodedBlock) {
            const decodedBlock = msgpack.decode(encodedBlock);
            /** @type {BlockData} */
            const blockData = {
                index: utils.convert.uint8Array.toNumber(decodedBlock[0]), // safe type: uint8 -> number
                supply: utils.convert.uint8Array.toNumber(decodedBlock[1]), // safe type: uint8 -> number
                coinBase: utils.convert.uint8Array.toNumber(decodedBlock[2]), // safe type: uint8 -> number
                difficulty: utils.convert.uint8Array.toNumber(decodedBlock[3]), // safe type: uint8 -> number
                legitimacy: utils.convert.uint8Array.toNumber(decodedBlock[4]), // safe type: uint8 -> number
                prevHash: utils.convert.uint8Array.toHex(decodedBlock[5]), // safe type: uint8 -> hex
                posTimestamp: utils.convert.uint8Array.toNumber(decodedBlock[6]), // safe type: uint8 -> number
                powReward: utils.convert.uint8Array.toNumber(decodedBlock[7]), // safe type: uint8 -> number
                Txs: []
            };

            for (let i = 0; i < decodedBlock[8].length; i++) {
                blockData.Txs.push(serializer.transaction.fromBinary_v2(decodedBlock[8][i]));
            }

            return blockData;
        }
    },
    block_finalized: {
        /** @param {BlockData} blockData */
        toBinary_v2(blockData) {
            const blockAsArray = [
                utils.convert.number.toUint8Array(blockData.index), // safe type: number
                utils.convert.number.toUint8Array(blockData.supply), // safe type: number
                utils.convert.number.toUint8Array(blockData.coinBase), // safe type: number
                utils.convert.number.toUint8Array(blockData.difficulty), // safe type: number
                utils.convert.number.toUint8Array(blockData.legitimacy), // safe type: number
                utils.convert.hex.toUint8Array(blockData.prevHash), // safe type: hex
                utils.convert.number.toUint8Array(blockData.posTimestamp), // safe type: number
                utils.convert.number.toUint8Array(blockData.timestamp), // safe type: number
                utils.convert.hex.toUint8Array(blockData.hash), // safe type: hex
                utils.convert.hex.toUint8Array(blockData.nonce), // safe type: hex
                [] // Txs
            ];

            for (let i = 0; i < blockData.Txs.length; i++) {
                blockAsArray[10].push(serializer.transaction.toBinary_v2(blockData.Txs[i]));
            };

            /** @type {Uint8Array} */
            const encoded = msgpack.encode(blockAsArray);
            return encoded;
        },
        /** @param {Uint8Array} encodedBlock */
        fromBinary_v2(encodedBlock) {
            const decodedBlock = msgpack.decode(encodedBlock);
            /** @type {BlockData} */
            const blockData = {
                index: utils.convert.uint8Array.toNumber(decodedBlock[0]), // safe type: uint8 -> number
                supply: utils.convert.uint8Array.toNumber(decodedBlock[1]), // safe type: uint8 -> number
                coinBase: utils.convert.uint8Array.toNumber(decodedBlock[2]), // safe type: uint8 -> number
                difficulty: utils.convert.uint8Array.toNumber(decodedBlock[3]), // safe type: uint8 -> number
                legitimacy: utils.convert.uint8Array.toNumber(decodedBlock[4]), // safe type: uint8 -> number
                prevHash: utils.convert.uint8Array.toHex(decodedBlock[5]), // safe type: uint8 -> hex
                posTimestamp: utils.convert.uint8Array.toNumber(decodedBlock[6]), // safe type: uint8 -> number   
                timestamp: utils.convert.uint8Array.toNumber(decodedBlock[7]), // safe type: uint8 -> number
                hash: utils.convert.uint8Array.toHex(decodedBlock[8]), // safe type: uint8 -> hex
                nonce: utils.convert.uint8Array.toHex(decodedBlock[9]), // safe type: uint8 -> hex
                Txs: []
            };

            for (let i = 0; i < decodedBlock[10].length; i++) {
                blockData.Txs.push(serializer.transaction.fromBinary_v2(decodedBlock[10][i]));
            }

            return blockData;
        }
    }
};
export default serializer;