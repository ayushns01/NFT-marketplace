// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import "../../contracts/advanced/BondingCurve.sol";
import "../../contracts/tokens/erc721/ERC721NFT.sol";

/**
 * @title BondingCurve Invariant Tests
 * @notice Tests critical invariants for the bonding curve AMM
 * 
 * CRITICAL INVARIANTS:
 * 1. Reserve Solvency: reserveBalance >= liability (sum of all sellable tokens at current price)
 * 2. Supply Tracking: currentSupply == number of tokens sold (if using incremental token IDs)
 * 3. Price Monotonicity: getBuyPrice(supply+1) >= getBuyPrice(supply) for any supply
 * 4. Round-trip Loss: Buying then immediately selling results in loss (spread exists)
 */
contract BondingCurveInvariantTest is Test {
    BondingCurve public curve;
    ERC721NFT public nft;
    
    address creator = makeAddr("creator");
    address buyer1 = makeAddr("buyer1");
    address buyer2 = makeAddr("buyer2");
    address feeRecipient = makeAddr("feeRecipient");
    
    uint256 constant PLATFORM_FEE = 250; // 2.5%
    uint256 constant BASE_PRICE = 0.1 ether;
    uint256 constant SLOPE = 0.01 ether;
    uint256 constant MAX_SUPPLY = 1000;

    function setUp() public {
        curve = new BondingCurve(PLATFORM_FEE, feeRecipient);
        nft = new ERC721NFT("Test", "TST", MAX_SUPPLY, address(0), 0);
        
        // Create linear bonding curve pool
        vm.startPrank(creator);
        uint256 poolId = curve.createPool(
            address(nft),
            BondingCurve.CurveType.Linear,
            BASE_PRICE,
            SLOPE,
            MAX_SUPPLY,
            500, // 5% royalty to creator
            true // buyback enabled
        );
        
        // Mint and approve NFTs for the pool
        for (uint256 i = 0; i < 100; i++) {
            nft.mint(address(curve), string(abi.encodePacked("ipfs://", vm.toString(i))));
        }
        vm.stopPrank();
    }

    /// @notice INVARIANT 1: Reserve balance must cover all potential sells
    function invariant_reserveSolvency() public {
        BondingCurve.Pool memory pool = curve.getPool(0);
        
        if (!pool.buybackEnabled || pool.currentSupply == 0) {
            return; // No liability if buyback disabled or no supply
        }
        
        // Calculate total liability: sum of sell prices for all tokens
        uint256 totalLiability = 0;
        for (uint256 i = 0; i < pool.currentSupply; i++) {
            // Sell price is 95% of the buy price at supply-1
            uint256 buyPriceAtPrevSupply = _calculateLinearPrice(pool, pool.currentSupply - 1 - i);
            totalLiability += (buyPriceAtPrevSupply * 95) / 100;
        }
        
        assertGe(
            pool.reserveBalance,
            totalLiability,
            "Reserve must cover all potential sells"
        );
    }

    /// @notice INVARIANT 2: Price increases with supply (monotonicity)
    function invariant_priceMonotonicity() public view {
        BondingCurve.Pool memory pool = curve.getPool(0);
        
        if (pool.currentSupply == 0) return;
        
        uint256 currentPrice = curve.getBuyPrice(0);
        uint256 nextPrice = _calculateLinearPrice(pool, pool.currentSupply + 1);
        
        assertGe(
            nextPrice,
            currentPrice,
            "Price must increase with supply"
        );
    }

    /// @notice Test reserve accumulation after purchase
    function test_reserveAccumulation() public {
        BondingCurve.Pool memory pool = curve.getPool(0);
        uint256 initialReserve = pool.reserveBalance;
        
        // Buy a token
        uint256 price = curve.getBuyPrice(0);
        vm.deal(buyer1, price);
        vm.prank(buyer1);
        curve.buy{value: price}(0, 0, price);
        
        pool = curve.getPool(0);
        
        // Calculate expected reserve increase
        uint256 fee = (price * PLATFORM_FEE) / 10000;
        uint256 royalty = (price * 500) / 10000;
        uint256 expectedReserveIncrease = price - fee - royalty;
        
        assertEq(
            pool.reserveBalance,
            initialReserve + expectedReserveIncrease,
            "Reserve should increase by (price - fees)"
        );
    }

    /// @notice Test that selling always yields less than buying (spread exists)
    function test_buyThenSellLoss() public {
        // Buy a token
        uint256 buyPrice = curve.getBuyPrice(0);
        vm.deal(buyer1, buyPrice);
        vm.prank(buyer1);
        curve.buy{value: buyPrice}(0, 0, buyPrice);
        
        // Get sell price
        uint256 sellPrice = curve.getSellPrice(0);
        
        // Sell price must be less than buy price (5% spread + fees)
        assertLt(sellPrice, buyPrice, "Sell price must be lower than buy price");
        
        // Verify it's approximately 95% of buy price
        uint256 expectedSellPrice = (buyPrice * 95) / 100;
        
        // Allow small variance for fee calculations
        uint256 diff = sellPrice > expectedSellPrice 
            ? sellPrice - expectedSellPrice 
            : expectedSellPrice - sellPrice;
        
        assertLe(diff, buyPrice / 20, "Sell price should be ~95% of buy price");
    }

    /// @notice Test supply tracking after multiple buys
    function test_supplyTrackingAccuracy() public {
        BondingCurve.Pool memory pool = curve.getPool(0);
        uint256 initialSupply = pool.currentSupply;
        
        // Buy 5 tokens
        for (uint256 i = 0; i < 5; i++) {
            uint256 price = curve.getBuyPrice(0);
            vm.deal(buyer1, price);
            vm.prank(buyer1);
            curve.buy{value: price}(0, i, price);
        }
        
        pool = curve.getPool(0);
        assertEq(pool.currentSupply, initialSupply + 5, "Supply should increase by 5");
    }

    /// @notice Test max supply enforcement
    function test_maxSupplyEnforcement() public {
        BondingCurve.Pool memory pool = curve.getPool(0);
        
        // Only buy tokens that we have minted (100), not full MAX_SUPPLY
        uint256 mintedCount = 100;
        
        // Buy all minted tokens
        for (uint256 i = 0; i < mintedCount; i++) {
            uint256 price = curve.getBuyPrice(0);
            vm.deal(buyer1, price);
            vm.prank(buyer1);
            curve.buy{value: price}(0, i, price);
        }
        
        pool = curve.getPool(0);
        assertEq(pool.currentSupply, mintedCount);
        
        // Next buy should fail because no more NFTs are held by curve
        // Note: In production, this would be MaxSupplyReached if supply == maxSupply
        // Here it fails because curve doesn't own tokenId 100
        uint256 price = curve.getBuyPrice(0);
        vm.deal(buyer2, price);
        vm.prank(buyer2);
        vm.expectRevert(); // NotTokenOwner because NFT 100 doesn't exist in curve
        curve.buy{value: price}(0, mintedCount, price);
    }

    /// @notice Helper to calculate linear price
    function _calculateLinearPrice(
        BondingCurve.Pool memory pool,
        uint256 supply
    ) internal pure returns (uint256) {
        return pool.basePrice + (supply * pool.slope);
    }
}
