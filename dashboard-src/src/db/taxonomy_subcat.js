'use strict';
/**
 * taxonomy_subcat.js — approved Main Cat -> Sub Cat structure.
 * Main Cats reuse the existing large_groups (group_code <-> Chinese name).
 * Each Sub Cat has a stable, non-Chinese code used in URLs and as a key.
 * Display order follows the approved list (NOT alphabetical).
 */

// group_code -> [ { code, name } ... ] in approved display order.
const SUB_CATS = {
  ELDERLY_CARE: [
    { code: 'ELD_ADULT_DIAPER', name: '成人尿片' },
    { code: 'ELD_ADULT_PAD', name: '成人護墊' },
  ],
  HEALTH_SUPPLIES: [
    { code: 'HS_MEDICAL_DEVICE', name: '血壓/血糖/醫療用品' },
  ],
  HEALTH_FOOD: [
    { code: 'HF_IMMUNE_LIVER_DRINK', name: '免疫系統/護肝補肺/保健飲料/保健沖調' },
    { code: 'HF_SLEEP_ENT_HAIR_SKIN', name: '助眠/耳鼻喉/養髮/美肌' },
    { code: 'HF_MEN_WOMEN', name: '男女士保健品' },
    { code: 'HF_PROBIOTICS', name: '益生菌' },
    { code: 'HF_BONE_JOINT', name: '骨骼關節' },
    { code: 'HF_EYE', name: '眼睛健康' },
    { code: 'HF_FISHOIL_CARDIO', name: '魚油/心血管健康' },
    { code: 'HF_TONIC', name: '滋補養生' },
    { code: 'HF_BRAIN_NMN', name: '腦部健康（NMN）' },
    { code: 'HF_GUT_SLIMMING', name: '腸胃消化/纖體' },
    { code: 'HF_CALCIUM_GLUCOSAMINE', name: '補鈣/葡萄糖胺' },
    { code: 'HF_VITAMIN', name: '維他命' },
    { code: 'HF_NUTRITION_MILK_PROTEIN', name: '營養奶粉/蛋白粉' },
    { code: 'HF_CHICKEN_ESSENCE_CORDYCEPS', name: '雞精/蟲草/靈芝' },
  ],
  FROZEN: [
    { code: 'FRZ_BALL_DUMPLING_DIMSUM_SOUP', name: '丸子餃子/點心/湯' },
    { code: 'FRZ_BEEF', name: '牛' },
    { code: 'FRZ_SEAFOOD_NON_FISH', name: '海鮮（魚除外）' },
    { code: 'FRZ_FISH', name: '魚' },
    { code: 'FRZ_PORK', name: '豬' },
    { code: 'FRZ_CHICKEN_WING_STEAK', name: '雞翼/雞扒' },
    { code: 'FRZ_CHICKEN_OTHER', name: '雞（其他部位）' },
    { code: 'FRZ_DUCK_LAMB_OTHER', name: '鴨/羊/其他肉類' },
    { code: 'FRZ_SNACK_DAIRY_SOY', name: '急凍小食/乳製品/豆製品' },
  ],
  PERSONAL_CARE: [
    { code: 'PC_ORAL', name: '口腔護理' },
    { code: 'PC_HAIR', name: '頭髮護理' },
    { code: 'PC_MEDICATED_OIL_TEST_MASK', name: '藥油/止痛貼/快測/口罩' },
    { code: 'PC_TOILET_PAPER', name: '廁紙/濕廁紙' },
    { code: 'PC_TISSUE_WIPE', name: '紙巾/濕紙巾' },
    { code: 'PC_BATH_LOTION', name: '沐浴/潤膚露' },
    { code: 'PC_FACE_CREAM_SUN_EYE', name: '面霜防曬/眼部護理' },
    { code: 'PC_FACE_SERUM_MASK', name: '面部精華/面膜' },
    { code: 'PC_FACE_BODY_CARE', name: '面部/身體護理' },
  ],
  HOME_CLEANING: [
    { code: 'HC_KITCHEN', name: '廚房用品' },
    { code: 'HC_LAUNDRY_POD_CARE', name: '洗衣球/衣物護理' },
    { code: 'HC_LAUNDRY_DETERGENT', name: '洗衣液/洗衣粉' },
    { code: 'HC_CLEANING_DISINFECT', name: '家居清潔/消毒用品' },
    { code: 'HC_HOUSEHOLD', name: '家居用品' },
  ],
  DRY_FOOD: [
    { code: 'DRY_AVOCADO_OTHER_OIL', name: '牛油果油/其他油' },
    { code: 'DRY_RICE', name: '米' },
    { code: 'DRY_NOODLE_INSTANT_PASTA', name: '麵類（即食麵/意粉）' },
    { code: 'DRY_CORN_PEANUT_OLIVE_OIL', name: '粟米油/花生油/橄欖油' },
    { code: 'DRY_SNACK_BISCUIT_DESSERT_CHOCO', name: '零食/餅乾/甜品（朱古力）' },
    { code: 'DRY_DRIED_SEAFOOD_SOUP', name: '蔘茸海味/南北貨/湯類' },
    { code: 'DRY_NUTRITION_NUT_BREAD_JAM', name: '營養食品/果仁/麵包/早餐果醬' },
    { code: 'DRY_CHICKEN_SOUP_CANNED_PICKLED', name: '雞湯/罐頭/醃製食品' },
    { code: 'DRY_CONDIMENT_SAUCE', name: '調味品/醬料' },
  ],
  MARKET_PRODUCTS: [
    { code: 'MKT_VEG_FRUIT', name: '蔬菜水果' },
    { code: 'MKT_FRESH_MEAT_SEAFOOD_EGG', name: '鮮肉海鮮（0–4°C）/雞蛋' },
  ],
  BEVERAGES: [
    { code: 'BEV_WATER_SODA', name: '水/汽水' },
    { code: 'BEV_INSTANT_DRINK', name: '沖調飲品' },
    { code: 'BEV_SOY_DAIRY', name: '豆奶/奶類' },
    { code: 'BEV_JUICE_ENERGY_ELECTROLYTE', name: '果汁/能量飲品/電解質水' },
    { code: 'BEV_TEA_COFFEE', name: '茶/咖啡' },
  ],
  PET_SUPPLIES: [
    { code: 'PET_KITTEN_PRESCRIPTION_CAT', name: '幼貓/處方貓糧' },
    { code: 'PET_DOG_SENIOR_PRESCRIPTION_WET', name: '狗高齡/處方/濕糧' },
    { code: 'PET_DOG_DRY', name: '狗乾糧' },
    { code: 'PET_CAT_DRY', name: '貓乾糧' },
    { code: 'PET_CAT_WET', name: '貓濕糧' },
    { code: 'PET_SUPPLIES_LITTER_PAD', name: '寵物用品（貓砂/狗尿墊）' },
    { code: 'PET_SNACK_SUPPLEMENT', name: '寵物零食/寵物保健食品' },
  ],
};

// Product Token name (name_zh) -> Sub Cat code. Tokens not listed here fall back to
// keyword classification of the SKU name; uncertain records go to review.
const TOKEN_TO_SUBCAT = {
  '豆奶': 'BEV_SOY_DAIRY',
  '牛奶': 'BEV_SOY_DAIRY',
  '杏仁奶': 'BEV_SOY_DAIRY',
  '洗衣液': 'HC_LAUNDRY_DETERGENT',
  '洗衣珠': 'HC_LAUNDRY_POD_CARE',
  '洗臉巾': 'PC_TISSUE_WIPE',
  '一口牛': 'FRZ_BEEF',
};

// Keyword rules (checked against normalized SKU name, first match wins) used when a
// SKU has no token or its token is unmapped. Returns Sub Cat code or null (=> review).
const KEYWORD_RULES = [
  ['BEV_SOY_DAIRY', ['豆奶', '豆漿', '杏仁奶', '燕麥奶', '牛奶', '奶']],
  ['HC_LAUNDRY_DETERGENT', ['洗衣液', '洗衣粉']],
  ['HC_LAUNDRY_POD_CARE', ['洗衣珠', '洗衣球', '洗衣膠囊']],
  ['PC_TISSUE_WIPE', ['洗臉巾', '濕紙巾', '紙巾']],
  ['FRZ_BEEF', ['牛柳', '牛肉', '一口牛', '肥牛']],
];

module.exports = { SUB_CATS, TOKEN_TO_SUBCAT, KEYWORD_RULES };
