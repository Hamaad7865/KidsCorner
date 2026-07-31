"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { MasterData } from "@/lib/master-data/queries"

import { BrandsPanel } from "./brands-panel"
import { CategoriesPanel } from "./categories-panel"
import { ColoursPanel } from "./colours-panel"
import { SizesPanel } from "./sizes-panel"

/**
 * The four master data tables everything else references. Categories lead
 * because a product cannot exist without one.
 */
export function MasterDataTabs({ data }: { data: MasterData }) {
  return (
    <Tabs defaultValue="categories" className="w-full">
      <TabsList>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="brands">Brands</TabsTrigger>
        <TabsTrigger value="colours">Colours</TabsTrigger>
        <TabsTrigger value="sizes">Sizes</TabsTrigger>
      </TabsList>

      <TabsContent value="categories" className="pt-6">
        <CategoriesPanel categories={data.categories} />
      </TabsContent>
      <TabsContent value="brands" className="pt-6">
        <BrandsPanel brands={data.brands} />
      </TabsContent>
      <TabsContent value="colours" className="pt-6">
        <ColoursPanel colours={data.colours} />
      </TabsContent>
      <TabsContent value="sizes" className="pt-6">
        <SizesPanel sizes={data.sizes} />
      </TabsContent>
    </Tabs>
  )
}
