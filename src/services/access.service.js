'use strict'

const shopModel = require("../models/shop.model")
const bcrypt = require('bcrypt')
const { createTokenPair, verifyJWT } = require('../auth/authUtils')
const { getInfoData } = require('../utils')
const { BadRequestError, AuthFailureError, ForbiddenError } = require("../cores/error.response")
const { findByEmail } = require("../services/shop.service")
const { generateKeyPairSync } = require('../utils/generateKeyPair')

// SERVICE
const KeyTokenService = require('../services/keyToken.service')
const ShopService = require('../services/shop.service')

const BCRYPT_SALT = 10

const RoleShop = {
    SHOP: 'SHOP',
    WRITER: 'WRITER',
    EDITOR: 'EDITOR',
    ADMIN: 'ADMIN'
}

class AccessService {
    static register = async ({ name, email, password }) => {
        const holderShop = await shopModel.findOne({ email }).lean()
        if (holderShop)
            throw new BadRequestError('Error: Shop already registered!')

        const passwordHashed = await bcrypt.hash(password, BCRYPT_SALT)
        const newShop = await shopModel.create({
            name, email, password: passwordHashed, roles: [RoleShop.SHOP]
        })

        if (newShop) {
            // const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
            //     modulusLength: 4096,
            //     publicKeyEncoding: {
            //         type: 'pkcs1', // Public key CryptoGraphy Standards!
            //         format: 'pem'
            //     },
            //     privateKeyEncoding: {
            //         type: 'pkcs1', // Public key CryptoGraphy Standards!
            //         format: 'pem'
            //     }
            // })

            const { privateKey, publicKey } = generateKeyPairSync()

            console.log({ privateKey, publicKey })

            const keyStore = await KeyTokenService.createKeyToken({
                userId: newShop._id,
                publicKey,
                privateKey
            })

            if (!keyStore)
                return {
                    code: 'xxxx',
                    message: 'publicKeyString error'
                }

            // Created token pair
            const tokens = await createTokenPair({ userId: newShop._id, email }, publicKey, privateKey)
            console.log(`Created token successfully::`, tokens)

            return {
                code: 201,
                metadata: {
                    shop: getInfoData({ fields: ['_id', 'name', 'email'], object: newShop }),
                    tokens
                }
            }
        }

        return {
            code: 200,
            metadata: null
        }
    }

    /* --- Login ---
        1. Check email
        2. Equal password
        3. Create token pair
        4. Generate tokens
        5. Get data and return login successfully
    */
    static login = async ({ email, password, refreshToken = null }) => {
        // Step 1
        const foundShop = await findByEmail({ email })
        if (!foundShop)
            throw new BadRequestError('Shop not found!')

        // Step 2
        const passwordMatched = await bcrypt.compare(password, foundShop.password)
        if (!passwordMatched)
            throw new AuthFailureError('Password not matched!')

        // Step 3
        const { privateKey, publicKey } = generateKeyPairSync()

        // Step 4
        const { _id: userId } = foundShop
        const tokens = await createTokenPair({ userId, email }, publicKey, privateKey)

        // Step 5
        await KeyTokenService.createKeyToken({
            userId, privateKey, publicKey,
            refreshToken: tokens.refreshToken
        })

        return {
            shop: getInfoData({ fields: ['_id', 'name', 'email'], object: foundShop }),
            tokens
        }
    }

    static logout = async ({ keyStore }) => {
        const delKey = await KeyTokenService.removeKeyById(keyStore._id)
        console.log({ delKey })
        return delKey
    }

    /*
        Check refresh token used to warning => refresh token is not secure
    */
    static handleRefreshToken = async (refreshToken) => {
        const foundToken = await KeyTokenService.findByRefreshTokenUsed(refreshToken)
        if (foundToken) {
            // Decode to see the payload
            const { userId, email } = verifyJWT(refreshToken, foundToken.privateKey)
            console.log({ userId, email })

            // Delete the keyStore
            await KeyTokenService.deleteKeyById(userId)
            throw new ForbiddenError('Refresh token is not secure!')
        }

        const tokenHolder = await KeyTokenService.findByRefreshToken(refreshToken)
        if (!tokenHolder) throw new AuthFailureError('Refresh token not found!')

        const { userId, email } = verifyJWT(refreshToken, tokenHolder.privateKey)
        console.log('[2] ---', { userId, email })

        const foundShop = await ShopService.findByEmail({ email })
        if (!foundShop) throw new AuthFailureError('Shop not found!')

        const tokens = await createTokenPair({ userId, email }, tokenHolder.publicKey, tokenHolder.privateKey)

        await KeyTokenService.updateRefreshTokenById(tokenHolder._id, tokens.refreshToken, refreshToken)

        return {
            user: { userId, email },
            tokens
        }
    }
}

module.exports = AccessService