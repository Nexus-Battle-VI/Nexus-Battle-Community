/**
 * Tokens de inyeccion de los casos de uso.
 *
 * Los casos de uso son clases sin decoradores: no conocen NestJS.
 */
export const OPEN_THREAD = Symbol('OpenThread')
export const PUBLISH_POST = Symbol('PublishPost')
export const HIDE_POST = Symbol('HidePost')
export const CLOSE_THREAD = Symbol('CloseThread')
export const GET_THREAD = Symbol('GetThread')
export const LIST_THREADS = Symbol('ListThreads')
export const LIST_OWN_POSTS = Symbol('ListOwnPosts')
export const PUBLISH_PRODUCT_COMMENT = Symbol('PublishProductComment')
export const LIST_PRODUCT_COMMENTS = Symbol('ListProductComments')
export const RATE_PRODUCT = Symbol('RateProduct')
export const GET_PRODUCT_REVIEW_SUMMARY = Symbol('GetProductReviewSummary')
