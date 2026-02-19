const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ProtocolRegistry", function () {
    let registry;
    let owner;
    let admin;
    let emergencyMultisig;
    let randomUser;
    let contractAddr1;
    let contractAddr2;
    let contractAddr3;

    beforeEach(async function () {
        [owner, admin, emergencyMultisig, randomUser, contractAddr1, contractAddr2, contractAddr3] =
            await ethers.getSigners();

        const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry");
        registry = await ProtocolRegistry.deploy(admin.address, emergencyMultisig.address);
    });

    describe("Constructor", function () {
        it("Should set protocol version to 1.0.0", async function () {
            expect(await registry.protocolVersion()).to.equal("1.0.0");
        });

        it("Should grant REGISTRY_ADMIN_ROLE to admin", async function () {
            const REGISTRY_ADMIN_ROLE = await registry.REGISTRY_ADMIN_ROLE();
            expect(await registry.hasRole(REGISTRY_ADMIN_ROLE, admin.address)).to.be.true;
        });

        it("Should grant EMERGENCY_ROLE to multisig", async function () {
            const EMERGENCY_ROLE = await registry.EMERGENCY_ROLE();
            expect(await registry.hasRole(EMERGENCY_ROLE, emergencyMultisig.address)).to.be.true;
        });

        it("Should grant DEFAULT_ADMIN_ROLE to admin", async function () {
            const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
            expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
        });

        it("Should revert if admin is zero address", async function () {
            const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry");
            await expect(
                ProtocolRegistry.deploy(ethers.ZeroAddress, emergencyMultisig.address)
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });

        it("Should revert if emergencyMultisig is zero address", async function () {
            const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry");
            await expect(
                ProtocolRegistry.deploy(admin.address, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });
    });

    describe("Contract Registration", function () {
        it("Should register a contract", async function () {
            await expect(
                registry.connect(admin).registerContract(contractAddr1.address, "Marketplace")
            ).to.emit(registry, "ContractRegistered")
                .withArgs(contractAddr1.address, "Marketplace");

            expect(await registry.registeredContracts(contractAddr1.address)).to.be.true;
            expect(await registry.getContractCount()).to.equal(1);
        });

        it("Should register multiple contracts", async function () {
            await registry.connect(admin).registerContract(contractAddr1.address, "Marketplace");
            await registry.connect(admin).registerContract(contractAddr2.address, "AuctionEngine");

            const contracts = await registry.getRegisteredContracts();
            expect(contracts.length).to.equal(2);
            expect(contracts[0]).to.equal(contractAddr1.address);
            expect(contracts[1]).to.equal(contractAddr2.address);
        });

        it("Should revert registering zero address", async function () {
            await expect(
                registry.connect(admin).registerContract(ethers.ZeroAddress, "Bad")
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });

        it("Should revert registering duplicate contract", async function () {
            await registry.connect(admin).registerContract(contractAddr1.address, "Marketplace");
            await expect(
                registry.connect(admin).registerContract(contractAddr1.address, "Marketplace")
            ).to.be.revertedWithCustomError(registry, "ContractAlreadyRegistered");
        });

        it("Should revert if non-admin registers", async function () {
            await expect(
                registry.connect(randomUser).registerContract(contractAddr1.address, "Marketplace")
            ).to.be.reverted;
        });
    });

    describe("Contract Deregistration", function () {
        beforeEach(async function () {
            await registry.connect(admin).registerContract(contractAddr1.address, "Marketplace");
            await registry.connect(admin).registerContract(contractAddr2.address, "AuctionEngine");
            await registry.connect(admin).registerContract(contractAddr3.address, "BondingCurve");
        });

        it("Should deregister a contract", async function () {
            await expect(
                registry.connect(admin).deregisterContract(contractAddr1.address)
            ).to.emit(registry, "ContractDeregistered")
                .withArgs(contractAddr1.address);

            expect(await registry.registeredContracts(contractAddr1.address)).to.be.false;
            expect(await registry.getContractCount()).to.equal(2);
        });

        it("Should handle swap-and-pop correctly when removing middle element", async function () {
            // Remove middle element (contractAddr2)
            await registry.connect(admin).deregisterContract(contractAddr2.address);
            
            const contracts = await registry.getRegisteredContracts();
            expect(contracts.length).to.equal(2);
            // contractAddr3 (last) should have been swapped into contractAddr2's position
            expect(contracts[0]).to.equal(contractAddr1.address);
            expect(contracts[1]).to.equal(contractAddr3.address);
        });

        it("Should handle deregistering first element", async function () {
            await registry.connect(admin).deregisterContract(contractAddr1.address);
            const contracts = await registry.getRegisteredContracts();
            expect(contracts.length).to.equal(2);
        });

        it("Should handle deregistering last element", async function () {
            await registry.connect(admin).deregisterContract(contractAddr3.address);
            const contracts = await registry.getRegisteredContracts();
            expect(contracts.length).to.equal(2);
            expect(contracts[0]).to.equal(contractAddr1.address);
            expect(contracts[1]).to.equal(contractAddr2.address);
        });

        it("Should revert deregistering unregistered contract", async function () {
            await expect(
                registry.connect(admin).deregisterContract(randomUser.address)
            ).to.be.revertedWithCustomError(registry, "ContractNotRegistered");
        });

        it("Should revert if non-admin deregisters", async function () {
            await expect(
                registry.connect(randomUser).deregisterContract(contractAddr1.address)
            ).to.be.reverted;
        });
    });

    describe("Emergency Pause/Unpause", function () {
        it("Should allow emergency multisig to pause protocol", async function () {
            await expect(
                registry.connect(emergencyMultisig).emergencyPause("Critical bug found")
            ).to.emit(registry, "ProtocolPaused")
                .withArgs(emergencyMultisig.address, "Critical bug found");

            expect(await registry.isProtocolPaused()).to.be.true;
        });

        it("Should allow emergency multisig to unpause protocol", async function () {
            await registry.connect(emergencyMultisig).emergencyPause("Bug");
            
            await expect(
                registry.connect(emergencyMultisig).emergencyUnpause()
            ).to.emit(registry, "ProtocolUnpaused")
                .withArgs(emergencyMultisig.address);

            expect(await registry.isProtocolPaused()).to.be.false;
        });

        it("Should revert if non-emergency role tries to pause", async function () {
            await expect(
                registry.connect(randomUser).emergencyPause("Hack attempt")
            ).to.be.reverted;
        });

        it("Should revert if non-emergency role tries to unpause", async function () {
            await registry.connect(emergencyMultisig).emergencyPause("Bug");
            await expect(
                registry.connect(randomUser).emergencyUnpause()
            ).to.be.reverted;
        });

        it("Should report correct paused state", async function () {
            expect(await registry.isProtocolPaused()).to.be.false;
            await registry.connect(emergencyMultisig).emergencyPause("test");
            expect(await registry.isProtocolPaused()).to.be.true;
        });
    });

    describe("Protocol Version", function () {
        it("Should update protocol version", async function () {
            await expect(
                registry.connect(admin).setProtocolVersion("2.0.0")
            ).to.emit(registry, "ProtocolVersionUpdated")
                .withArgs("1.0.0", "2.0.0");

            expect(await registry.protocolVersion()).to.equal("2.0.0");
        });

        it("Should revert if non-admin updates version", async function () {
            await expect(
                registry.connect(randomUser).setProtocolVersion("99.0.0")
            ).to.be.reverted;
        });
    });

    describe("View Functions", function () {
        it("Should return empty array when no contracts registered", async function () {
            const contracts = await registry.getRegisteredContracts();
            expect(contracts.length).to.equal(0);
        });

        it("Should return zero count when no contracts registered", async function () {
            expect(await registry.getContractCount()).to.equal(0);
        });
    });
});
