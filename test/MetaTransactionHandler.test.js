const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("MetaTransactionHandler", function () {
    async function deployFixture() {
        const [owner, relayer, user, target] = await ethers.getSigners();

        // Deploy MetaTransactionHandler
        const MetaTransactionHandler = await ethers.getContractFactory("MetaTransactionHandler");
        const handler = await MetaTransactionHandler.deploy();
        await handler.waitForDeployment();

        // Set trusted relayer (owner is trusted by default in constructor)
        await handler.setRelayer(relayer.address, true);

        // Deploy a simple counter contract as target
        const Counter = await ethers.getContractFactory("MockCounter");
        const counter = await Counter.deploy();
        await counter.waitForDeployment();

        return { handler, counter, owner, relayer, user, target };
    }

    async function createMetaTx(handler, user, to, value, data, deadline, nonce) {
        const domain = {
            name: "MetaTransactionHandler",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await handler.getAddress()
        };

        const types = {
            MetaTransaction: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "data", type: "bytes" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" }
            ]
        };

        const message = {
            from: user.address,
            to: to,
            value: value,
            data: data,
            nonce: nonce,
            deadline: deadline
        };

        const signature = await user.signTypedData(domain, types, message);
        return { message, signature };
    }

    describe("Meta Transaction Execution", function () {
        it("should execute meta transaction via trusted relayer", async function () {
            const { handler, counter, relayer, user } = await loadFixture(deployFixture);

            const deadline = (await time.latest()) + 3600; // 1 hour from now
            const data = counter.interface.encodeFunctionData("increment");

            const { message, signature } = await createMetaTx(
                handler, user, await counter.getAddress(), 0, data, deadline, 0
            );

            // Initial count is 0
            expect(await counter.count()).to.equal(0);

            // Execute via relayer
            await handler.connect(relayer).executeMetaTransaction(message, signature);

            // Count should be 1
            expect(await counter.count()).to.equal(1);
        });

        it("should emit MetaTransactionExecuted event", async function () {
            const { handler, counter, relayer, user } = await loadFixture(deployFixture);

            const deadline = (await time.latest()) + 3600;
            const data = counter.interface.encodeFunctionData("increment");

            const { message, signature } = await createMetaTx(
                handler, user, await counter.getAddress(), 0, data, deadline, 0
            );

            await expect(
                handler.connect(relayer).executeMetaTransaction(message, signature)
            ).to.emit(handler, "MetaTransactionExecuted");
        });
    });

    describe("Deadline Validation", function () {
        it("should revert if deadline passed", async function () {
            const { handler, counter, relayer, user } = await loadFixture(deployFixture);

            const deadline = (await time.latest()) - 1; // Already passed
            const data = counter.interface.encodeFunctionData("increment");

            const { message, signature } = await createMetaTx(
                handler, user, await counter.getAddress(), 0, data, deadline, 0
            );

            await expect(
                handler.connect(relayer).executeMetaTransaction(message, signature)
            ).to.be.revertedWithCustomError(handler, "DeadlineExpired");
        });
    });

    describe("Nonce Management", function () {
        it("should increment nonce after execution", async function () {
            const { handler, counter, relayer, user } = await loadFixture(deployFixture);

            expect(await handler.nonces(user.address)).to.equal(0);

            const deadline = (await time.latest()) + 3600;
            const data = counter.interface.encodeFunctionData("increment");

            const { message, signature } = await createMetaTx(
                handler, user, await counter.getAddress(), 0, data, deadline, 0
            );

            await handler.connect(relayer).executeMetaTransaction(message, signature);

            expect(await handler.nonces(user.address)).to.equal(1);
        });

        it("should revert if nonce is wrong", async function () {
            const { handler, counter, relayer, user } = await loadFixture(deployFixture);

            const deadline = (await time.latest()) + 3600;
            const data = counter.interface.encodeFunctionData("increment");

            // Use wrong nonce (1 instead of 0)
            const { message, signature } = await createMetaTx(
                handler, user, await counter.getAddress(), 0, data, deadline, 1
            );

            await expect(
                handler.connect(relayer).executeMetaTransaction(message, signature)
            ).to.be.revertedWithCustomError(handler, "InvalidSignature");
        });

        it("should prevent replay attacks", async function () {
            const { handler, counter, relayer, user } = await loadFixture(deployFixture);

            const deadline = (await time.latest()) + 3600;
            const data = counter.interface.encodeFunctionData("increment");

            const { message, signature } = await createMetaTx(
                handler, user, await counter.getAddress(), 0, data, deadline, 0
            );

            // First execution succeeds
            await handler.connect(relayer).executeMetaTransaction(message, signature);

            // Replay same transaction fails
            await expect(
                handler.connect(relayer).executeMetaTransaction(message, signature)
            ).to.be.revertedWithCustomError(handler, "InvalidSignature");
        });
    });

    describe("Trusted Relayer", function () {
        it("should reject execution from untrusted relayer", async function () {
            const { handler, counter, user, target } = await loadFixture(deployFixture);

            const deadline = (await time.latest()) + 3600;
            const data = counter.interface.encodeFunctionData("increment");

            const { message, signature } = await createMetaTx(
                handler, user, await counter.getAddress(), 0, data, deadline, 0
            );

            // Execute from non-relayer (target is not trusted)
            await expect(
                handler.connect(target).executeMetaTransaction(message, signature)
            ).to.be.revertedWithCustomError(handler, "OnlyRelayer");
        });

        it("should allow owner to add/remove trusted relayers", async function () {
            const { handler, owner, target } = await loadFixture(deployFixture);

            // Add target as trusted relayer
            await expect(handler.connect(owner).setRelayer(target.address, true))
                .to.emit(handler, "RelayerUpdated")
                .withArgs(target.address, true);

            expect(await handler.trustedRelayers(target.address)).to.be.true;

            // Remove target as trusted relayer
            await handler.connect(owner).setRelayer(target.address, false);
            expect(await handler.trustedRelayers(target.address)).to.be.false;
        });
    });

    describe("Signature Validation", function () {
        it("should revert with invalid signature", async function () {
            const { handler, counter, relayer, user, owner } = await loadFixture(deployFixture);

            const deadline = (await time.latest()) + 3600;
            const data = counter.interface.encodeFunctionData("increment");

            // Sign with wrong signer
            const domain = {
                name: "MetaTransactionHandler",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await handler.getAddress()
            };

            const types = {
                MetaTransaction: [
                    { name: "from", type: "address" },
                    { name: "to", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "data", type: "bytes" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const message = {
                from: user.address, // Claims to be user
                to: await counter.getAddress(),
                value: 0,
                data: data,
                nonce: 0,
                deadline: deadline
            };

            // But signed by owner
            const badSignature = await owner.signTypedData(domain, types, message);

            await expect(
                handler.connect(relayer).executeMetaTransaction(message, badSignature)
            ).to.be.revertedWithCustomError(handler, "InvalidSignature");
        });
    });
});
