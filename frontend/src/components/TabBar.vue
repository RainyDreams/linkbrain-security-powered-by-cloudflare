<template>
  <nav class="fixed bottom-0 left-0 right-0 bg-ths-card/90 backdrop-blur-md border-t border-gray-700 flex justify-around pb-6 pt-3 z-50">
    <router-link to="/admin/buy" custom v-slot="{ navigate, isActive }">
      <button @click="navigate" class="flex flex-col items-center gap-1" :class="isActive ? 'text-ths-red' : 'text-gray-400'">
        <span class="text-xl font-bold">买入</span>
        <span class="text-[10px]">Buy</span>
      </button>
    </router-link>

    <router-link to="/admin/sell" custom v-slot="{ navigate, isActive }">
      <button @click="navigate" class="flex flex-col items-center gap-1" :class="isActive ? 'text-ths-green' : 'text-gray-400'">
        <span class="text-xl font-bold">卖出</span>
        <span class="text-[10px]">Sell</span>
      </button>
    </router-link>

    <router-link to="/admin/cancel" custom v-slot="{ navigate, isActive }">
      <button @click="navigate" class="flex flex-col items-center gap-1" :class="isActive ? 'text-blue-400' : 'text-gray-400'">
        <span class="text-xl font-bold">撤单</span>
        <span class="text-[10px]">Cancel</span>
      </button>
    </router-link>

    <router-link to="/admin/holdings" custom v-slot="{ navigate, isActive }">
      <button @click="navigate" class="flex flex-col items-center gap-1" :class="isActive ? 'text-yellow-400' : 'text-gray-400'">
        <span class="text-xl font-bold">持仓</span>
        <span class="text-[10px]">Pos</span>
      </button>
    </router-link>
  </nav>
</template>