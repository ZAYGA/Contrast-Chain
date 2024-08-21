'use strict';

import { BlockData, Block } from "./index.mjs";
import etc from './etc.mjs';
import utils from './utils.mjs';

const savedDataPath = etc.path ? etc.path.join(etc.__dirname, 'savedData') : null;
const powDataPath = etc.path ? etc.path.join(etc.__dirname, 'powData') : null;
const blocksPath = etc.path ? etc.path.join(powDataPath, 'blocks') : null;
if (etc.path && !etc.fs.existsSync(savedDataPath)) { etc.fs.mkdirSync(savedDataPath); }
if (etc.path && !etc.fs.existsSync(powDataPath)) { etc.fs.mkdirSync(powDataPath); }
if (etc.path && !etc.fs.existsSync(blocksPath)) { etc.fs.mkdirSync(blocksPath); }
const numberOfBlockFilesInFolder = 1000;

// we are now splitting blocks files into subFolder to avoid performance issues

//#region --- LOADING BLOCKCHAIN/BLOCKS ---
function getListOfFoldersInBlocksDirectory() {
    if (etc.path) { 
        const blocksFolders = etc.fs.readdirSync(blocksPath).filter(fileName => etc.fs.lstatSync(etc.path.join(blocksPath, fileName)).isDirectory());
        
        // named as 0-999, 1000-1999, 2000-2999, etc. => sorting by the first number
        const blocksFoldersSorted = blocksFolders.sort((a, b) => parseInt(a.split('-')[0], 10) - parseInt(b.split('-')[0], 10));
        //console.log(blocksFoldersSorted);

        return blocksFoldersSorted;
    }
}
function loadBlockchainLocally(extension = 'json') {
    const chain = [];
    const blocksFolders = getListOfFoldersInBlocksDirectory();

    for (let i = 0; i < blocksFolders.length; i++) {
        const blockFilesSorted = getListOfFilesInBlocksDirectory(blocksFolders[i], extension);
        const chainPart = loadBlocksOfFolderLocally(blockFilesSorted, extension);
        chain.push(...chainPart);
    }

    return chain;
}
/** @param {number[]} blockFilesSorted */
function loadBlocksOfFolderLocally(blockFilesSorted, extension = 'json') {
    const chainPart = [];
    for (let i = 0; i < blockFilesSorted.length; i++) {
        const blockIndex = blockFilesSorted[i];

        try {
            const block = loadBlockLocally(blockIndex, extension);
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
function getListOfFilesInBlocksDirectory(subFolder = '', extension = 'json') {
    if (etc.path) {
        const subFolderPath = etc.path.join(blocksPath, subFolder);
        return etc.fs.readdirSync(subFolderPath).filter(fileName => fileName.endsWith('.' + extension))
        .map(fileName => (
          parseInt(fileName.split('.')[0], 10)
        ))
        .sort((a, b) => a - b);
    }
    // TODO: Implement for browser - localStorage.setItem('blocks', JSON.stringify([]));
    // TODO: Implement for extension - chrome.storage.local.set({ blocks: [] });
}
/** @param {number} blockIndex */
function loadBlockLocally(blockIndex, extension = 'json') {
    const blocksFolderName = `${Math.floor(blockIndex / numberOfBlockFilesInFolder) * numberOfBlockFilesInFolder}-${Math.floor(blockIndex / numberOfBlockFilesInFolder) * numberOfBlockFilesInFolder + numberOfBlockFilesInFolder - 1}`;
    const blocksFolderPath = etc.path.join(blocksPath, blocksFolderName);
    
    const blockIndexStr = blockIndex.toString();

    if (extension === 'json') {
        return loadBlockDataJSON(blockIndexStr, blocksFolderPath);
    } else if (extension === 'bin') {
        //return loadBlockDataBinary(blockIndexStr, blocksFolderPath);
        return loadBlockDataBinary_v1(blockIndexStr, blocksFolderPath);
    }
}
function loadBlockDataJSON(blockIndexStr, blocksFolderPath) {
    const blockFileName = `${blockIndexStr}.json`;
    const filePath = etc.path.join(blocksFolderPath, blockFileName);
    const blockContent = etc.fs.readFileSync(filePath, 'utf8');
    return Block.blockDataFromJSON(blockContent);
}
function loadBlockDataBinary_v1(blockIndexStr, blocksFolderPath) {
    const blockDataPath = etc.path.join(blocksFolderPath, `${blockIndexStr}.bin`);
    const compressed = etc.fs.readFileSync(blockDataPath);
    
    return utils.compression.blockData.fromBinary_v1(compressed);
}
//#endregion -----------------------------

//#region --- SAVING BLOCKCHAIN/BLOCKS ---
/**
 * Save a block to the local storage
 * @param {BlockData} blockData - The block to save
 */
function saveBlockDataLocally(blockData, extension = 'json') {
    const result = { success: true, message: 'Block ${blockContent.index} saved' };
    
    try {
        const blocksFolderName = `${Math.floor(blockData.index / numberOfBlockFilesInFolder) * numberOfBlockFilesInFolder}-${Math.floor(blockData.index / numberOfBlockFilesInFolder) * numberOfBlockFilesInFolder + numberOfBlockFilesInFolder - 1}`;
        const blocksFolderPath = etc.path.join(blocksPath, blocksFolderName);
        if (!etc.fs.existsSync(blocksFolderPath)) { etc.fs.mkdirSync(blocksFolderPath); }

        if (extension === 'json') {
            saveBlockDataJSON(blockData, blocksFolderPath);
        } else if (extension === 'bin') {
            //saveBlockDataBinary(blockData, blocksFolderPath);
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
    const blockchainInfoPath = etc.path.join(powDataPath, 'blockchainInfo.csv');
    const blockchainInfoHeader = 'blockIndex,coinbaseReward,timestamp,difficulty,timeBetweenBlocks\n';
    const blocksDataLines = blocksInfo.map(data => {
        return `${data.blockIndex},${data.coinbaseReward},${data.timestamp},${data.difficulty},${data.timeBetweenBlocks}`;
    }).join('\n');
    const blocksDataContent = blockchainInfoHeader + blocksDataLines;

    etc.fs.writeFileSync(blockchainInfoPath, blocksDataContent, 'utf8');
   
    return { success: true, message: "Blockchain's Info saved" };
}

function saveBlockDataJSON(blockData, blocksFolderPath) {
    const blockFilePath = etc.path.join(blocksFolderPath, `${blockData.index}.json`);
    etc.fs.writeFileSync(blockFilePath, JSON.stringify(blockData, (key, value) => {
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
    const compressed = utils.compression.blockData.toBinary_v1(blockData, blocksFolderPath);

    const blockDataPath = etc.path.join(blocksFolderPath, `${blockData.index}.bin`);
    etc.fs.writeFileSync(blockDataPath, compressed);
}
/*function saveBlockDataBinaryOptimized(blockData, blocksFolderPath) {
    const miniBlockHeader = utils.compression.blockDataToMiniBlockHeader(blockData);
    const uint8Header = utils.compression.Uint8FromMiniBlockHeader(miniBlockHeader);
    // TODO
}*/
//#endregion -----------------------------

//#region --- BASIC SAVING/LOADING ---
/**
 * Save data to a JSON file
 * @param {string} fileName - The name of the file
 * @param {any} data - The data to save
 */
function saveJSON(fileName, data) {
    try {
        const filePath = etc.path.join(savedDataPath, `${fileName}.json`);
        etc.fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
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
        const filePath = etc.path.join(savedDataPath, `${fileName}.json`);
        return JSON.parse(etc.fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return false;
    }
}
//#endregion -----------------------------

const storage = {
    loadBlockchainLocally,
    saveBlockDataLocally,
    saveBlockchainInfoLocally,
    saveJSON,
    loadJSON
};

export default storage;