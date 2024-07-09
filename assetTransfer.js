'use strict';

// Dependencies
const stringify = require('json-stringify-deterministic');  // Ensures consistent stringification
const sortKeysRecursive = require('sort-keys-recursive');  // Recursively sorts object keys
const { Contract } = require('fabric-contract-api');  // Import the base contract class from Hyperledger Fabric

// Initialize grid power and transaction log
let currentGridPower = '10KW';
let transactionLog = [];

// Define the AssetTransfer contract extending the base Contract class
class AssetTransfer extends Contract {

    // Initialize the ledger with predefined assets
    async InitLedger(ctx) {
        const assets = [
            // Define an array of initial assets with their properties
            { id: 'a1', name: 'producer1', type: 'producer', orgValue: 1300, currValue: 1300 },
            { id: 'a2', name: 'producer2', type: 'producer', orgValue: 1400, currValue: 1400 },
            { id: 'a3', name: 'producer3', type: 'producer', orgValue: 1500, currValue: 1500 },
            { id: 'a4', name: 'consumer1', type: 'consumer', orgValue: 600, currValue: 600 },
            { id: 'a5', name: 'consumer2', type: 'consumer', orgValue: 700, currValue: 700 },
            { id: 'a6', name: 'consumer3', type: 'consumer', orgValue: 800, currValue: 800 },
            { id: 'a7', name: 'producer4', type: 'producer', orgValue: 350, currValue: 350 },
            { id: 'a8', name: 'consumer4', type: 'consumer', orgValue: 450, currValue: 450 },
        ];

        // Store each asset in the ledger
        for (const asset of assets) {
            asset.docType = 'asset';
            await ctx.stub.putState(asset.id, Buffer.from(stringify(sortKeysRecursive(asset))));
        }
    }

    // Create a new asset and store it in the ledger
    async CreateAsset(ctx, id, name, type, orgValue, currValue) {
        const exists = await this.AssetExists(ctx, id);
        if (exists) {
            throw new Error(`The asset ${id} already exists`);
        }

        const asset = {
            id: id,
            name: name,
            type: type,
            orgValue: orgValue,
            currValue: currValue,
        };
        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(asset))));
        return JSON.stringify(asset);
    }

    // Read and return an asset from the ledger
    async ReadAsset(ctx, id) {
        const assetJSON = await ctx.stub.getState(id);
        if (!assetJSON || assetJSON.length === 0) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return assetJSON.toString();
    }

    // Update an existing asset in the ledger
    async UpdateAsset(ctx, id, name, type, orgValue, currValue) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }

        const updatedAsset = {
            id: id,
            name: name,
            type: type,
            orgValue: orgValue,
            currValue: currValue,
        };
        return ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(updatedAsset))));
    }

    // Delete an asset from the ledger
    async DeleteAsset(ctx, id) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return ctx.stub.deleteState(id);
    }

    // Check if an asset exists in the ledger
    async AssetExists(ctx, id) {
        const assetJSON = await ctx.stub.getState(id);
        return assetJSON && assetJSON.length > 0;
    }

    // Transfer an asset to a new owner
    async TransferAsset(ctx, id, newOwner) {
        const assetString = await this.ReadAsset(ctx, id);
        const asset = JSON.parse(assetString);
        const oldOwner = asset.Owner;
        asset.Owner = newOwner;
        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(asset))));
        return oldOwner;
    }

    // Retrieve all assets from the ledger
    async GetAllAssets(ctx) {
        const allResults = [];
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }

    // View all assets with specific formatting for producers and consumers
    async ViewAllAssets(ctx) {
        const allAssets = await this.GetAllAssets(ctx);
        const assets = JSON.parse(allAssets);

        let result = 'List of Assets:\n';
        for (const asset of assets) {
            if (asset.type === 'producer') {
                result += `ID: ${asset.id}, Name: ${asset.name}, OrgSupply: ${asset.orgValue}, CurrSupply: ${asset.currValue}\n`;
            } else if (asset.type === 'consumer') {
                result += `ID: ${asset.id}, Name: ${asset.name}, OrgDemand: ${asset.orgValue}, CurrDemand: ${asset.currValue}\n`;
            }
        }
        return result;
    }

    // Calculate and view the CG (consumption-generation) ratios
    async calcAndViewCG(ctx) {
        const allAssets = await this.GetAllAssets(ctx);
        const assets = JSON.parse(allAssets);

        const producers = assets.filter(asset => asset.type === 'producer');
        const consumers = assets.filter(asset => asset.type === 'consumer');

        producers.sort((a, b) => b.currValue - a.currValue);  // Sort producers by descending current value
        consumers.sort((a, b) => a.currValue - b.currValue);  // Sort consumers by ascending current value

        const minLength = Math.min(producers.length, consumers.length);
        const cgRatios = [];

        for (let i = 0; i < minLength; i++) {
            const producer = producers[i];
            const consumer = consumers[i];

            const ratio = consumer.currValue / (producer.currValue - consumer.currValue);

            cgRatios.push({
                producer: producer.id,
                consumer: consumer.id,
                ratio: ratio,
            });
        }

        let result = 'CG Ratios:\n';
        for (const cg of cgRatios) {
            result += `Producer: ${cg.producer}, Consumer: ${cg.consumer}, Ratio: ${cg.ratio}\n`;
        }

        return result;
    }

    // Perform trades between producers and consumers, update the ledger, and log transactions
    async tradeN(ctx, N) {
        const allAssets = await this.GetAllAssets(ctx);
        const assets = JSON.parse(allAssets);

        const producers = assets.filter(asset => asset.type === 'producer');
        const consumers = assets.filter(asset => asset.type === 'consumer');

        producers.sort((a, b) => b.currValue - a.currValue);  // Sort producers by descending current value
        consumers.sort((a, b) => a.currValue - b.currValue);  // Sort consumers by ascending current value

        const minLength = Math.min(producers.length, consumers.length, N);
        let netPowerChange = 0;

        for (let i = 0; i < minLength; i++) {
            const producer = producers[i];
            const consumer = consumers[i];

            if (producer.currValue <= consumer.currValue) {
                const deficit = consumer.currValue - producer.currValue;
                transactionLog.push(`${new Date().toISOString()} - Energy flowing from Producer ${producer.name} to Consumer ${consumer.name}: ${producer.currValue}KW`);
                transactionLog.push(`${new Date().toISOString()} - Producer ${producer.name} exhausted. Additional ${deficit}KW taken from the grid.`);
                netPowerChange -= deficit;
                consumer.currValue = 0;
                producer.currValue = 0;
            } else {
                transactionLog.push(`${new Date().toISOString()} - Energy flowing from Producer ${producer.name} to Consumer ${consumer.name}: ${consumer.currValue}KW`);
                netPowerChange += producer.currValue - consumer.currValue;
                producer.currValue -= consumer.currValue;
                consumer.currValue = 0;
            }

            await this.UpdateAsset(ctx, producer.id, producer.name, producer.type, producer.orgValue, producer.currValue);
            await this.UpdateAsset(ctx, consumer.id, consumer.name, consumer.type, consumer.orgValue, consumer.currValue);
        }

        currentGridPower = `${parseInt(currentGridPower) + netPowerChange}KW`;
        return `Net power change: ${netPowerChange}KW, New grid power: ${currentGridPower}`;
    }

    // View the transaction log
    async ViewTxnLog(ctx) {
        return transactionLog.join('\n');
    }

    // Get the current grid power
    async GetCurrentGridPower(ctx) {
        return `Current grid power is ${currentGridPower}`;
    }
}

// Export the AssetTransfer contract
module.exports = AssetTransfer;
