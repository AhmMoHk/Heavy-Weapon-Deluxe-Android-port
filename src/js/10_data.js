/* Heavy Weapon mobile port - static tables recovered from the original game */
'use strict';
(function () {
  /* sound table (id = index) with base volumes, exactly as in the original executable */
  HW.SOUNDS = [
    ['gunpowerup', 0.5], ['tankfire', 0.7], ['tankfire1', 0.6], ['tankfire2', 0.6], ['tankfire3', 0.8], ['tankfire4', 0.7],
    ['bigexplode', 1.0], ['smallexplode', 0.6], ['bombfall', 0.7], ['bullethit', 0.5], ['tankexplode', 0.9], ['missile', 0.7],
    ['nukeblast', 0.9], ['powerup', 0.5], ['sparking', 1.0], ['laser', 0.4], ['bossblast', 1.0], ['buttondown', 0.5],
    ['buttonup', 0.5], ['smallmissile', 0.6], ['tanklaser', 0.5], ['denied', 0.5], ['stats', 0.5], ['alert', 0.4],
    ['pupcopter', 0.7], ['star', 0.7], ['laserpowerup', 0.5], ['satlaser', 0.5], ['sat1', 0.4], ['sat2', 0.4],
    ['sat3', 0.4], ['sat4', 0.4], ['sat5', 0.4], ['sat6', 0.4], ['sat7', 0.4], ['shortkey', 0.4],
    ['longkey', 0.4], ['friendly1', 0.6], ['friendly2', 0.6], ['friendly3', 0.6], ['friendlydie', 0.6], ['megalaser', 0.7],
    ['enemytankgun', 0.8], ['shorting', 0.2], ['statichit', 0.5], ['staticshot', 0.5], ['megalaser_out', 0.5], ['megalaser_start', 0.5],
    ['megalaser_stop', 0.5], ['mapover', 0.6], ['starsmash', 0.5], ['energyfire', 0.7], ['statbeep', 0.5], ['reinforcements', 0.5],
    ['enemyfire', 1.0], ['v_atomictank', 0.8], ['v_gameover', 0.8], ['v_getready', 0.8], ['v_levelcomplete', 0.8], ['v_megalaser', 0.8],
    ['v_prepare', 0.8], ['v_danger', 0.8], ['v_waffle', 0.8], ['megaup1', 0.5], ['megaup2', 0.5], ['megaup3', 0.5],
    ['megaup4', 0.5], ['orbhit', 0.5], ['flak', 0.5], ['airraid', 0.6], ['robotsmash', 0.5], ['robotlaser', 0.5],
    ['earthquake', 0.8], ['airmine', 0.5], ['meteor', 0.5], ['tractorbeam', 0.5], ['diesel', 0.7], ['airbrake', 0.9],
    ['chain', 0.5], ['bigthud', 1.0], ['thunder', 1.0], ['boltcharge', 0.9], ['jetdive', 1.0], ['deflect', 0.5],
    ['bosscopter', 0.8], ['swoosh', 0.5], ['bosslaser', 0.5], ['bosslaserblast', 0.3], ['shieldup', 0.5], ['shielddown', 0.5],
    ['upgrade', 1.0], ['speedup', 0.6]
  ];
  HW.snd = function (id, x, vol) {
    var s = HW.SOUNDS[id];
    if (!s) return null;
    var o = {};
    // pan from the position across the battlefield; kept to +-0.5 so that nothing vanishes into one small phone
    // speaker at the screen edges
    if (x !== undefined && x !== null) { var B = HW.scene && HW.scene.board, hw = B && B.half ? B.half : HW.W / 2; o.pan = HW.clamp(x / hw, -1, 1) * 0.5; }
    if (vol !== undefined) o.vol = vol;
    return HW.Audio.play(s[0], o);
  };

  /* music track ids as used by the original (table index) */
  HW.MUSIC = { 0: 'lovetheme', 1: 'songA', 2: 'songB', 3: 'songC', 4: 'songD', 5: 'songE' };
  HW.music = function (id, onStart) { HW.Audio.playMusic(id === null ? null : HW.MUSIC[id], onStart); };
  /* the original's FadeOut of the current song: speed 0.004 per update = 2.5 s */
  HW.musicFade = function (ms) { HW.Audio.fadeOutMusic(ms || 2500); };

  /* power-up table: name, max level, mission factor (level may not exceed mission*factor) */
  HW.PUPS = [
    { name: 'NUKE ACQUIRED', max: 3, factor: 0 },
    { name: 'SHIELD UPGRADED', max: 3, factor: 0 },
    { name: 'SPEED INCREASED', max: 10000, factor: 1 },
    { name: 'GUN POWER UP', max: 10000, factor: 1 },
    { name: 'RAPID FIRE', max: 10000, factor: 1 },
    { name: 'SPREAD SHOT', max: 4, factor: 0.5 }
  ];
  HW.WEAPON_NAMES = ['DEFENSE ORBS', 'HOMING MISSILE', 'LASER', 'ROCKETS', 'FLAK CANNON', 'THUNDERSTRIKE'];

  /* craft ids are 1-based in the original (index into craft.xml + 1) */
  HW.CRAFT = { PROPFIGHTER: 1, SMALLJET: 2, BOMBER: 3, JETFIGHTER: 4, TRUCK: 5, BIGBOMBER: 6, SMALLCOPTER: 7, MEDCOPTER: 8,
    BIGCOPTER: 9, DELTABOMBER: 10, DELTAJET: 11, BIGMISSILE: 12, SUPERBOMBER: 13, FATBOMBER: 14, BLIMP: 15, SATELLITE: 16,
    STRAFER: 17, ENEMYTANK: 18, DOZER: 19, DEFLECTOR: 20, CRUISE: 21 };

  /* level background names (index = mission % 9, 9 = red star hq, 10 = survival) */
  HW.LEVEL_BG = ['frigistan', 'blastnya', 'petrovakia', 'dictastroika', 'zamblamia', 'tankylvania', 'vodkavania',
    'antagonistan', 'killingrad', 'red_star_hq', 'survival'];
  /* mission index (0..18) -> country index (0..9) */
  HW.countryOf = function (m) { return m >= 18 ? 9 : m % 9; };

  /* the gas station names shown at the end of a level */
  HW.GAS_NAMES = ['GROUND ZERO GAS', "ROD'S FUEL RODS", "NED'S NUKES"];

  /* rank names; rank r>0 uses insignia frame r-1 */
  HW.RANKS = ['PRIVATE', 'PRIVATE FIRST CLASS', 'CORPORAL', 'SERGEANT', 'SERGEANT FIRST CLASS', 'MASTER SERGEANT',
    'FIRST SERGEANT', 'WARRANT OFFICER', 'CHIEF WARRANT OFFICER', 'SECOND LIEUTENANT', 'FIRST LIEUTENANT', 'CAPTAIN',
    'MAJOR', 'LIEUTENANT COLONEL', 'COLONEL', 'MAJOR GENERAL', 'LIEUTENANT GENERAL', 'GENERAL', 'GENERAL OF THE ARMY',
    'ULTIMATE TANKER'];
})();
