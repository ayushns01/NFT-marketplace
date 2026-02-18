// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import "../../contracts/advanced/FractionalVault.sol";
import "../../contracts/tokens/erc721/ERC721NFT.sol";

/**
 * @title FractionalVault Invariant Tests
 * @notice Tests critical invariants for the fractionalization vault
 * 
 * CRITICAL INVARIANTS:
 * 1. Share Accounting: shareToken.totalSupply() == vault.totalShares (until buyout)
 * 2. NFT Custody: If vault is Active, contract must hold the NFT
 * 3. Buyout Math: After buyout, claimable amount == buyoutPrice * userShares / totalShares
 * 4. State Transitions: Active → Bought (via buyout) OR Active → Redeemed (via redeem)
 */
contract FractionalVaultInvariantTest is Test {
    FractionalVault public vault;
    ERC721NFT public nft;
    
    address curator = makeAddr("curator");
    address buyer = makeAddr("buyer");
    address shareholder1 = makeAddr("shareholder1");
    address shareholder2 = makeAddr("shareholder2");
    
    uint256 constant INITIAL_SHARES = 1_000_000;
    uint256 constant RESERVE_PRICE = 10 ether;

    function setUp() public {
        vault = new FractionalVault();
        nft = new ERC721NFT("Test", "TST", 1000, address(0), 0);
        
        // Mint NFT to curator
        vm.prank(curator);
        nft.mint(curator, "ipfs://test");
        
        // Fractionalize
        vm.startPrank(curator);
        nft.approve(address(vault), 0);
        vault.fractionalize(
            address(nft),
            0,
            INITIAL_SHARES,
            RESERVE_PRICE,
            "Fractional Test",
            "fTST"
        );
        vm.stopPrank();
    }

    /// @notice INVARIANT 1: Total shares equals shareToken supply before buyout
    function invariant_shareTokenSupplyMatchesTotalShares() public {
        FractionalVault.Vault memory v = vault.getVault(1);
        
        if (v.state == FractionalVault.VaultState.Active) {
            ShareToken shareToken = ShareToken(v.shareToken);
            assertEq(
                shareToken.totalSupply(),
                v.totalShares,
                "Share token supply must equal vault totalShares when Active"
            );
        }
    }

    /// @notice INVARIANT 2: Contract custody of NFT
    function invariant_nftCustody() public {
        FractionalVault.Vault memory v = vault.getVault(1);
        
        if (v.state == FractionalVault.VaultState.Active) {
            assertEq(
                nft.ownerOf(0),
                address(vault),
                "Vault must hold NFT when Active"
            );
        } else if (v.state == FractionalVault.VaultState.Bought) {
            // NFT should be transferred to buyer
            assertTrue(
                nft.ownerOf(0) != address(vault),
                "Vault should not hold NFT after buyout"
            );
        }
    }

    /// @notice INVARIANT 3: Buyout price distribution
    function invariant_buyoutPriceDistribution() public {
        FractionalVault.Vault memory v = vault.getVault(1);
        
        if (v.state == FractionalVault.VaultState.Bought) {
            ShareToken shareToken = ShareToken(v.shareToken);
            uint256 totalSupply = shareToken.totalSupply();
            uint256 claimedShares = vault.claimedShares(1);
            
            // Unclaimed shares * price should equal contract balance (minus rounding dust)
            uint256 expectedBalance = ((totalSupply - claimedShares) * v.buyoutPrice) / v.totalShares;
            uint256 actualBalance = address(vault).balance;
            
            // Allow up to 1% difference for rounding
            uint256 diff = actualBalance > expectedBalance 
                ? actualBalance - expectedBalance 
                : expectedBalance - actualBalance;
            
            assertLe(
                diff,
                v.buyoutPrice / 100,
                "Contract balance should match unclaimed proceeds (within 1%)"
            );
        }
    }

    /// @notice Test state transition from Active to Bought
    function test_stateTransition_ActiveToBought() public {
        FractionalVault.Vault memory v = vault.getVault(1);
        assertEq(uint8(v.state), uint8(FractionalVault.VaultState.Active));
        
        // Execute buyout
        vm.deal(buyer, 20 ether);
        vm.prank(buyer);
        vault.buyout{value: RESERVE_PRICE}(1);
        
        v = vault.getVault(1);
        assertEq(uint8(v.state), uint8(FractionalVault.VaultState.Bought));
    }

    /// @notice Test that shares cannot be inflated after fractionalization
    function test_noShareInflation() public {
        FractionalVault.Vault memory v = vault.getVault(1);
        ShareToken shareToken = ShareToken(v.shareToken);
        
        uint256 initialSupply = shareToken.totalSupply();
        
        // Transfer shares around
        vm.prank(curator);
        shareToken.transfer(shareholder1, 100_000);
        
        // Total supply should not change
        assertEq(shareToken.totalSupply(), initialSupply);
        assertEq(shareToken.totalSupply(), INITIAL_SHARES);
    }

    /// @notice Test claimable amount calculation
    function test_claimableAmountCalculation() public {
        // Setup: transfer shares to multiple holders
        FractionalVault.Vault memory v = vault.getVault(1);
        ShareToken shareToken = ShareToken(v.shareToken);
        
        vm.startPrank(curator);
        shareToken.transfer(shareholder1, 300_000); // 30%
        shareToken.transfer(shareholder2, 200_000); // 20%
        // Curator keeps 500_000 (50%)
        vm.stopPrank();
        
        // Buyout at 15 ETH
        vm.deal(buyer, 20 ether);
        vm.prank(buyer);
        vault.buyout{value: 15 ether}(1);
        
        // Check claimable amounts
        uint256 curatorClaimable = vault.getClaimableAmount(1, curator);
        uint256 sh1Claimable = vault.getClaimableAmount(1, shareholder1);
        uint256 sh2Claimable = vault.getClaimableAmount(1, shareholder2);
        
        assertEq(curatorClaimable, 7.5 ether); // 50% of 15 ETH
        assertEq(sh1Claimable, 4.5 ether);     // 30% of 15 ETH
        assertEq(sh2Claimable, 3 ether);       // 20% of 15 ETH
        
        // Sum should equal buyout price
        assertEq(curatorClaimable + sh1Claimable + sh2Claimable, 15 ether);
    }
}
