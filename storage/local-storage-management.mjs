'use strict';

import { BlockData, Block } from "../src/block.mjs";
import utils from '../src/utils.mjs';

/**
* @typedef {import("../src/block.mjs").BlockData} BlockData
* @typedef {import("../src/node.mjs").Node} Node
*/

const fs = await import('fs');
const path = await import('path');
const url = await import('url');
const __filename = url.fileURLToPath(import.meta.url);
const parentFolder = path.dirname(__filename);
const __dirname = path.dirname(parentFolder);

const filesStoragePath = path.join(__dirname, 'storage');
const blocksPath = path.join(filesStoragePath, 'blocks');
if (path && !fs.existsSync(filesStoragePath)) { fs.mkdirSync(filesStoragePath); }
if (path && !fs.existsSync(blocksPath)) { fs.mkdirSync(blocksPath); }
const numberOfBlockFilesInFolder = 1000;

// A primitive way to store the blockchain data and wallet data etc...
// Only few functions are exported, the rest are used internally
// As usual, use Ctrl + k, Ctrl + 0 to fold all blocks of code

// Better in a class with static methods...

//#region --- UTILS ---
/**
 * @param {BlockData[]} chain
 * @param {BlockData[]} controlChain
 */
function controlChainIntegrity(chain, controlChain) {
    // Control the chain integrity
    for (let i = 0; i < controlChain.length; i++) {
        const controlBlock = controlChain[i];
        const block = chain[i];
        controlObjectEqualValues(controlBlock, block);
    }
}
/**
 * @param {object} object1
 * @param {object} object2
 */
function controlObjectEqualValues(object1, object2) {
    for (const key in object1) {
        const value1 = object1[key];
        const value2 = object2[key];
        if (typeof value1 === 'object') {
            controlObjectEqualValues(value1, value2);
        } else if (value1 !== value2) {
            throw new Error(`Control failed - key: ${key}`);
        }
    }
}
function extractBlocksMiningInfo(chain) {
    const blocksInfo = [];

    for (let i = 0; i < chain.length; i++) {
        const block = chain[i];

        blocksInfo.push({ 
            blockIndex: block.index,
            coinbaseReward: block.coinBase,
            timestamp: block.timestamp,
            difficulty: block.difficulty,
            timeBetweenBlocks: i === 0 ? 0 : block.timestamp - chain[i - 1].timestamp
        });
    }

    return blocksInfo;
}
//#endregion -----------------------------

//#region --- LOADING BLOCKCHAIN/BLOCKS ---
/**
 * Load the blockchain from the local storage
 * @param {Node} node - The node to load the blockchain into
 * @param {boolean} saveBlocksInfo - Whether to save the basic informations of the blocks in a .csv file
 */
async function loadBlockchainLocally(node, saveBlocksInfo = false) {
    const id = node.id;
    const blocksFolders = getListOfFoldersInBlocksDirectory(id);
    const nbOfBlocksInStorage = countFilesInBlocksDirectory(id, blocksFolders, 'bin');
    const progressLogger = new utils.ProgressLogger(nbOfBlocksInStorage);
    
    /** @type {BlockData} */
    let lastBlockData = undefined;
    let blockLoadedCount = 0;
    for (let i = 0; i < blocksFolders.length; i++) {
        const blocksFolder = blocksFolders[i];
        const chainFiles = getListOfFilesInBlocksDirectory(id, blocksFolder, 'bin');
        const chainPart = loadBlocksOfFolderLocally(id, chainFiles, 'bin');

        const controlChainFiles = getListOfFilesInBlocksDirectory(id, blocksFolder, 'json');
        const controlChainPart = loadBlocksOfFolderLocally(id, controlChainFiles, 'json');

        controlChainIntegrity(chainPart, controlChainPart);

        const newStakesOutputs = await node.utxoCache.digestConfirmedBlocks(chainPart);
        if (newStakesOutputs.length > 0) { node.vss.newStakes(newStakesOutputs); }
        lastBlockData = chainPart[chainPart.length - 1];

        blockLoadedCount += chainPart.length;
        progressLogger.logProgress(blockLoadedCount);

        if (saveBlocksInfo) { // basic informations .csv
            const blocksInfo = extractBlocksMiningInfo(chainPart);
            saveBlockchainInfoLocally(blocksInfo);
        }
    }

    return lastBlockData;
}
function getListOfFoldersInBlocksDirectory(id) {
    if (!path) { return false; }

    const targetPath = path.join(blocksPath, id);
    if (!fs.existsSync(targetPath)) { fs.mkdirSync(targetPath); }
    const blocksFolders = fs.readdirSync(targetPath).filter(fileName => fs.lstatSync(path.join(targetPath, fileName)).isDirectory());
    
    // named as 0-999, 1000-1999, 2000-2999, etc... => sorting by the first number
    const blocksFoldersSorted = blocksFolders.sort((a, b) => parseInt(a.split('-')[0], 10) - parseInt(b.split('-')[0], 10));

    return blocksFoldersSorted;
}
function countFilesInBlocksDirectory(id, blocksFolders, extension = 'bin') {
    const targetPath = path.join(blocksPath, id);
    let totalFiles = 0;
    blocksFolders.forEach(folder => {
        const files = fs.readdirSync(path.join(targetPath, folder)).filter(fileName => fileName.endsWith(`.${extension}`));
        totalFiles += files.length;
    });

    return totalFiles;
}
/**
 * @param {string} id
 * @param {number[]} blockFilesSorted
 * @param {string} extension
 */
function loadBlocksOfFolderLocally(id, blockFilesSorted, extension = 'json') {
    const chainPart = [];
    for (let i = 0; i < blockFilesSorted.length; i++) {
        const blockIndex = blockFilesSorted[i];

        try {
            const block = loadBlockLocally(id, blockIndex, extension);
            chainPart.push(block);
        } catch (error) {
            console.error(error.stack);
            console.log(`Error while loading block ${blockIndex}/${blockFilesSorted.length},
                aborting loading the rest of the chain.`);
            break;
        }
    }

    return chainPart;
}
function getListOfFilesInBlocksDirectory(id, subFolder = '', extension = 'json') {
    if (!path) { return false; }

    const targetPath = path.join(blocksPath, id);
    const subFolderPath = path.join(targetPath, subFolder);
    return fs.readdirSync(subFolderPath).filter(fileName => fileName.endsWith('.' + extension))
    .map(fileName => (
        parseInt(fileName.split('.')[0], 10)
    ))
    .sort((a, b) => a - b);
    // TODO: Implement for browser - localStorage.setItem('blocks', JSON.stringify([]));
    // TODO: Implement for extension - chrome.storage.local.set({ blocks: [] });
}
/** 
 * @param {string} id
 * @param {number} blockIndex
 * @param {string} extension
 */
function loadBlockLocally(id, blockIndex, extension = 'json') {
    const targetPath = path.join(blocksPath, id);
    const blocksFolderName = `${Math.floor(blockIndex / numberOfBlockFilesInFolder) * numberOfBlockFilesInFolder}-${Math.floor(blockIndex / numberOfBlockFilesInFolder) * numberOfBlockFilesInFolder + numberOfBlockFilesInFolder - 1}`;
    const blocksFolderPath = path.join(targetPath, blocksFolderName);
    
    const blockIndexStr = blockIndex.toString();

    if (extension === 'json') {
        return loadBlockDataJSON(blockIndexStr, blocksFolderPath);
    } else if (extension === 'bin') {
        return loadBlockDataBinary_v1(blockIndexStr, blocksFolderPath);
    }
}
function loadBlockDataJSON(blockIndexStr, blocksFolderPath) {
    const blockFileName = `${blockIndexStr}.json`;
    const filePath = path.join(blocksFolderPath, blockFileName);
    const blockContent = fs.readFileSync(filePath, 'utf8');
    const blockData = Block.blockDataFromJSON(blockContent);
    
    return blockData;
}
function loadBlockDataBinary_v1(blockIndexStr, blocksFolderPath) {
    const blockDataPath = path.join(blocksFolderPath, `${blockIndexStr}.bin`);
    const compressed = fs.readFileSync(blockDataPath);
    const decompressed = utils.compression.msgpack_Zlib.blockData.fromBinary_v1(compressed);
    
    return decompressed;
}
//#endregion -----------------------------

//#region --- SAVING BLOCKCHAIN/BLOCKS ---
/**
 * Save a block to the local storage
 * @param {BlockData} blockData - The block to save
 */
function saveBlockDataLocally(id, blockData, extension = 'json') {
    const result = { success: true, message: 'Block ${blockContent.index} saved' };
    const targetPath = path.join(blocksPath, id);

    try {
        const blocksFolderName = `${Math.floor(blockData.index / numberOfBlockFilesInFolder) * numberOfBlockFilesInFolder}-${Math.floor(blockData.index / numberOfBlockFilesInFolder) * numberOfBlockFilesInFolder + numberOfBlockFilesInFolder - 1}`;
        const blocksFolderPath = path.join(targetPath, blocksFolderName);
        if (!fs.existsSync(blocksFolderPath)) { fs.mkdirSync(blocksFolderPath); }

        if (extension === 'json') {
            saveBlockDataJSON(blockData, blocksFolderPath);
        } else if (extension === 'bin') {
            saveBlockDataBinary_v1(blockData, blocksFolderPath);
        }
    } catch (error) {
        console.log(error.stack);
        /** @type {string} */
        result.message = error.message;
    }

    return result;
}
/** @param {BlockData[]} blocksInfo */
function saveBlockchainInfoLocally(blocksInfo) {
    const blockchainInfoPath = path.join(powDataPath, 'blockchainInfo.csv');
    const blockchainInfoHeader = 'blockIndex,coinbaseReward,timestamp,difficulty,timeBetweenBlocks\n';
    const blocksDataLines = blocksInfo.map(data => {
        return `${data.blockIndex},${data.coinbaseReward},${data.timestamp},${data.difficulty},${data.timeBetweenBlocks}`;
    }).join('\n');
    const blocksDataContent = blockchainInfoHeader + blocksDataLines;

    fs.writeFileSync(blockchainInfoPath, blocksDataContent, 'utf8');
   
    return { success: true, message: "Blockchain's Info saved" };
}

function saveBlockDataJSON(blockData, blocksFolderPath) {
    const blockFilePath = path.join(blocksFolderPath, `${blockData.index}.json`);
    fs.writeFileSync(blockFilePath, JSON.stringify(blockData, (key, value) => {
        if (value === undefined) {
          return undefined; // Exclude from the result
        }
        return value; // Include in the result
      }), 'utf8');
}
/** 
 * @param {BlockData} blockData
 * @param {string} blocksFolderPath
 */
function saveBlockDataBinary_v1(blockData, blocksFolderPath) {
    const compressed = utils.compression.msgpack_Zlib.blockData.toBinary_v1(blockData, blocksFolderPath);

    const blockDataPath = path.join(blocksFolderPath, `${blockData.index}.bin`);
    fs.writeFileSync(blockDataPath, compressed);
}
//#endregion -----------------------------

//#region --- BASIC SAVING/LOADING ---
/**
 * Save data to a JSON file
 * @param {string} fileName - The name of the file
 * @param {any} data - The data to save
 */
function saveJSON(fileName, data) {
    try {
        const filePath = path.join(filesStoragePath, `${fileName}.json`);
        const subFolder = path.dirname(filePath);
        if (!fs.existsSync(subFolder)) { fs.mkdirSync(subFolder); }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(error.stack);
        return false;
    }
}
/**
 * Load data from a JSON file
 * @param {string} fileName - The name of the file
 * @returns {any} The loaded data
 */
function loadJSON(fileName) {
    try {
        const filePath = path.join(filesStoragePath, `${fileName}.json`);
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return false;
    }
}
//#endregion -----------------------------



const localStorage_v1 = {
    loadBlockchainLocally,
    saveBlockDataLocally,
    saveJSON,
    loadJSON
};

export default localStorage_v1;