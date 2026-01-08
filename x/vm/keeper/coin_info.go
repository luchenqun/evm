package keeper

import (
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	evmtrace "github.com/cosmos/evm/trace"
	"github.com/cosmos/evm/x/vm/types"

	sdk "github.com/cosmos/cosmos-sdk/types"
)

// LoadEvmCoinInfo load EvmCoinInfo from bank denom metadata
func (k Keeper) LoadEvmCoinInfo(ctx sdk.Context) (_ types.EvmCoinInfo, err error) {
	params := k.GetParams(ctx)
	ctx, span := ctx.StartSpan(tracer, "LoadEvmCoinInfo", trace.WithAttributes(
		attribute.String("evm_denom", params.EvmDenom),
	))
	defer func() { evmtrace.EndSpanErr(span, err) }()
	var decimals types.Decimals

	// Try to find metadata by evm_denom first
	evmDenomMetadata, found := k.bankWrapper.GetDenomMetaData(ctx, params.EvmDenom)

	// If not found, try to find by extended_denom (which might be the base denom)
	if !found && params.ExtendedDenomOptions != nil {
		evmDenomMetadata, found = k.bankWrapper.GetDenomMetaData(ctx, params.ExtendedDenomOptions.ExtendedDenom)
	}

	if !found {
		extendedDenomStr := "N/A"
		if params.ExtendedDenomOptions != nil {
			extendedDenomStr = params.ExtendedDenomOptions.ExtendedDenom
		}
		return types.EvmCoinInfo{}, fmt.Errorf("denom metadata for %s (or extended denom %s) could not be found", params.EvmDenom, extendedDenomStr)
	}

	var displayExp, evmDenomExp, baseExp uint32
	displayFound, evmDenomFound, baseFound := false, false, false

	for _, denomUnit := range evmDenomMetadata.DenomUnits {
		if denomUnit.Denom == evmDenomMetadata.Display {
			displayExp = denomUnit.Exponent
			displayFound = true
		}
		if denomUnit.Denom == params.EvmDenom {
			evmDenomExp = denomUnit.Exponent
			evmDenomFound = true
		}
		if denomUnit.Denom == evmDenomMetadata.Base {
			baseExp = denomUnit.Exponent
			baseFound = true
		}
	}

	if !displayFound {
		return types.EvmCoinInfo{}, fmt.Errorf("display denom %s not found in denom_units", evmDenomMetadata.Display)
	}
	if !evmDenomFound {
		return types.EvmCoinInfo{}, fmt.Errorf("evm denom %s not found in denom_units", params.EvmDenom)
	}
	if !baseFound {
		return types.EvmCoinInfo{}, fmt.Errorf("base denom %s not found in denom_units", evmDenomMetadata.Base)
	}

	// Calculate decimals: the difference between display exponent and evm denom exponent
	// represents how many decimal places the evm denom has relative to the display denom.
	// For example, if display is "atom" (exp=18) and evm_denom is "uatom" (exp=12),
	// then 1 atom = 10^(18-12) uatom = 10^6 uatom, meaning uatom has 6 decimal places.
	// This means ConversionFactor[6] = 10^12 is needed to convert uatom to the 18-decimal representation.
	//
	// IMPORTANT: The base denom must be the extended denom (smallest unit) with exponent=0.
	// For non-18-decimal chains: base must equal extended_denom (e.g., "aatom" with exp=0).
	if baseExp != 0 {
		return types.EvmCoinInfo{}, fmt.Errorf("base denom exponent must be 0, got %d for %s", baseExp, evmDenomMetadata.Base)
	}
	if displayExp < evmDenomExp {
		return types.EvmCoinInfo{}, fmt.Errorf("display denom exponent (%d) must be greater than or equal to evm denom exponent (%d)", displayExp, evmDenomExp)
	}
	decimals = types.Decimals(evmDenomExp)

	var extendedDenom string
	if decimals == 18 {
		extendedDenom = params.EvmDenom
	} else {
		if params.ExtendedDenomOptions == nil {
			return types.EvmCoinInfo{}, fmt.Errorf("extended denom options cannot be nil for non-18-decimal chains")
		}
		extendedDenom = params.ExtendedDenomOptions.ExtendedDenom
	}

	return types.EvmCoinInfo{
		Denom:         params.EvmDenom,
		ExtendedDenom: extendedDenom,
		DisplayDenom:  evmDenomMetadata.Display,
		Decimals:      decimals.Uint32(),
	}, nil
}

// InitEvmCoinInfo load EvmCoinInfo from bank denom metadata and store it in the module
func (k Keeper) InitEvmCoinInfo(ctx sdk.Context) (err error) {
	ctx, span := ctx.StartSpan(tracer, "InitEvmCoinInfo")
	defer func() { evmtrace.EndSpanErr(span, err) }()
	coinInfo, err := k.LoadEvmCoinInfo(ctx)
	if err != nil {
		return err
	}
	return k.SetEvmCoinInfo(ctx, coinInfo)
}

// GetEvmCoinInfo returns the EVM Coin Info stored in the module
func (k Keeper) GetEvmCoinInfo(ctx sdk.Context) (coinInfo types.EvmCoinInfo) {
	ctx, span := ctx.StartSpan(tracer, "GetEvmCoinInfo")
	defer span.End()
	store := ctx.KVStore(k.storeKey)
	bz := store.Get(types.KeyPrefixEvmCoinInfo)
	if bz == nil {
		return k.defaultEvmCoinInfo
	}
	k.cdc.MustUnmarshal(bz, &coinInfo)
	return
}

// SetEvmCoinInfo sets the EVM Coin Info stored in the module
func (k Keeper) SetEvmCoinInfo(ctx sdk.Context, coinInfo types.EvmCoinInfo) (err error) {
	ctx, span := ctx.StartSpan(tracer, "SetEvmCoinInfo", trace.WithAttributes(
		attribute.String("denom", coinInfo.Denom),
		attribute.Int64("decimals", int64(coinInfo.Decimals)),
	))
	defer func() { evmtrace.EndSpanErr(span, err) }()
	store := ctx.KVStore(k.storeKey)
	bz, err := k.cdc.Marshal(&coinInfo)
	if err != nil {
		return err
	}

	store.Set(types.KeyPrefixEvmCoinInfo, bz)
	return nil
}
